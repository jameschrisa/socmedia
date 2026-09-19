import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { clipRequestSchema, type MediaAsset, type PostFormat } from "@socmedia/shared";
import type { Db } from "../db/database";
import { MediaRepo } from "../db/repositories/media";
import { BadRequestError, NotFoundError } from "../middleware/errors";
import {
  copyMediaFiles,
  deleteMediaFiles,
  ensureUploadsDir,
  formatDuration,
  resolveMediaPath,
  saveDataUrl,
  saveUploadBuffer,
  VideoTooLongError,
} from "../services/media";
import { posterFrame, trimVideo } from "../services/video";
import { log } from "../services/logger";
import { asyncHandler } from "../utils/asyncHandler";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) cb(null, true);
    else cb(new Error("Only image/* or video/* files are accepted"));
  },
});

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof raw === "string") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export function mediaRouter(db: Db): Router {
  const router = Router();
  const repo = new MediaRepo(db);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json(repo.listByOrg(req.org!.id));
    })
  );

  router.post(
    "/",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new BadRequestError("Missing file field");
      const orgId = req.org!.id;
      let saved;
      try {
        saved = await saveUploadBuffer(orgId, req.file.buffer, req.file.mimetype, req.file.originalname);
      } catch (err) {
        if (err instanceof VideoTooLongError) {
          throw new BadRequestError(`Videos must be 5 minutes or shorter (this one is ${formatDuration(err.durationSeconds)})`);
        }
        throw err;
      }
      const now = new Date().toISOString();
      const asset: MediaAsset = {
        id: nanoid(),
        orgId,
        kind: saved.kind,
        filename: saved.filename,
        mimeType: saved.mimeType,
        size: saved.size,
        width: saved.width ?? null,
        height: saved.height ?? null,
        durationSeconds: saved.durationSeconds ?? null,
        url: saved.url,
        thumbnailUrl: saved.thumbnailUrl ?? null,
        tags: parseTags(req.body.tags),
        sourceAssetId: (req.body.sourceAssetId as string) || null,
        format: (req.body.format as PostFormat) || null,
        createdAt: now,
      };
      const created = repo.create(asset);
      log.info("media", `Uploaded ${created.kind} "${created.filename}"`, { orgId, userId: req.user?.id, data: { mediaId: created.id, size: created.size } });
      res.status(201).json(created);
    })
  );

  router.post(
    "/export",
    asyncHandler(async (req, res) => {
      const { dataUrl, filename, sourceAssetId, format, tags } = req.body ?? {};
      if (typeof dataUrl !== "string") throw new BadRequestError("dataUrl is required");
      const orgId = req.org!.id;
      const saved = await saveDataUrl(orgId, dataUrl, typeof filename === "string" ? filename : undefined);
      const now = new Date().toISOString();
      const asset: MediaAsset = {
        id: nanoid(),
        orgId,
        kind: saved.kind,
        filename: saved.filename,
        mimeType: saved.mimeType,
        size: saved.size,
        width: saved.width ?? null,
        height: saved.height ?? null,
        durationSeconds: null,
        url: saved.url,
        thumbnailUrl: saved.thumbnailUrl ?? null,
        tags: parseTags(tags),
        sourceAssetId: sourceAssetId || null,
        format: format || null,
        createdAt: now,
      };
      const created = repo.create(asset);
      res.status(201).json(created);
    })
  );

  /** Trim/crop/mute a video asset with ffmpeg, either as a new derived asset or replacing it in place. */
  router.post(
    "/:id/clip",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing || existing.orgId !== req.org!.id || existing.kind !== "video") {
        throw new NotFoundError(`Media ${req.params.id} not found`);
      }
      const input = clipRequestSchema.parse(req.body);
      const sourceDuration = existing.durationSeconds ?? 0;
      if (input.end > sourceDuration + 0.05) {
        throw new BadRequestError(`Clip end (${input.end}s) is beyond the source video's duration (${sourceDuration}s)`);
      }

      const orgId = existing.orgId;
      const dir = ensureUploadsDir(orgId);
      const base = existing.filename.replace(/\.[^.]+$/, "");
      const clipName = `${base}-clip-${input.start}s-${input.end}s.mp4`;
      const outputPath = path.join(dir, clipName);

      const probe = await trimVideo({
        input: resolveMediaPath(existing.url),
        output: outputPath,
        start: input.start,
        end: input.end,
        format: input.format ?? null,
        muted: input.muted,
      });

      const posterName = `${path.parse(clipName).name}_poster.jpg`;
      const posterPath = path.join(dir, posterName);
      await posterFrame(outputPath, posterPath);
      const posterUrl = `/uploads/${orgId}/${posterName}`;
      const clipUrl = `/uploads/${orgId}/${clipName}`;
      const size = fs.statSync(outputPath).size;

      if (input.mode === "replace") {
        const previous = { url: existing.url, thumbnailUrl: existing.thumbnailUrl };
        const updated = repo.replaceFile(existing.id, {
          filename: clipName,
          mimeType: "video/mp4",
          size,
          width: probe.width,
          height: probe.height,
          durationSeconds: probe.durationSeconds,
          url: clipUrl,
          thumbnailUrl: posterUrl,
          format: input.format ?? existing.format ?? null,
        });
        deleteMediaFiles(previous);
        log.info("media", `Replaced clip on media ${updated!.id}`, { orgId, userId: req.user?.id, data: { mediaId: updated!.id } });
        res.json(updated);
        return;
      }

      const created = repo.create({
        id: nanoid(),
        orgId,
        kind: "video",
        filename: clipName,
        mimeType: "video/mp4",
        size,
        width: probe.width,
        height: probe.height,
        durationSeconds: probe.durationSeconds,
        url: clipUrl,
        thumbnailUrl: posterUrl,
        tags: [...existing.tags, "clip"],
        sourceAssetId: existing.id,
        format: input.format ?? null,
        createdAt: new Date().toISOString(),
      });
      log.info("media", `Created clip ${created.id} from ${existing.id}`, { orgId, userId: req.user?.id, data: { mediaId: created.id, sourceAssetId: existing.id } });
      res.status(201).json(created);
    })
  );

  /** Replace an asset's file in place (image editor "Save"): same id, new pixels. */
  router.put(
    "/:id/replace",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing || existing.orgId !== req.org!.id) throw new NotFoundError("Media not found");
      const { dataUrl, format } = req.body ?? {};
      if (typeof dataUrl !== "string") throw new BadRequestError("dataUrl is required");
      const base = existing.filename.replace(/\.[^.]+$/, "");
      const saved = await saveDataUrl(existing.orgId, dataUrl, `${base}.jpg`);
      const previous = { url: existing.url, thumbnailUrl: existing.thumbnailUrl };
      const updated = repo.replaceFile(existing.id, {
        filename: saved.filename,
        mimeType: saved.mimeType,
        size: saved.size,
        width: saved.width ?? null,
        height: saved.height ?? null,
        url: saved.url,
        thumbnailUrl: saved.thumbnailUrl ?? null,
        format: typeof format === "string" ? format : existing.format,
      });
      deleteMediaFiles(previous);
      log.info("media", `Replaced media ${updated!.id}`, { orgId: existing.orgId, userId: req.user?.id, data: { mediaId: updated!.id } });
      res.json(updated);
    })
  );

  /** Clone an asset (files copied, new id) so it can be edited independently. */
  router.post(
    "/:id/duplicate",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing || existing.orgId !== req.org!.id) throw new NotFoundError("Media not found");
      const saved = await copyMediaFiles(existing, existing.orgId);
      const copy = repo.create({
        ...existing,
        id: nanoid(),
        filename: saved.filename,
        mimeType: saved.mimeType,
        size: saved.size,
        width: saved.width ?? existing.width ?? null,
        height: saved.height ?? existing.height ?? null,
        url: saved.url,
        thumbnailUrl: saved.thumbnailUrl ?? null,
        sourceAssetId: existing.id,
        createdAt: new Date().toISOString(),
      });
      log.info("media", `Duplicated media ${existing.id} as ${copy.id}`, { orgId: existing.orgId, userId: req.user?.id, data: { mediaId: copy.id, sourceAssetId: existing.id } });
      res.status(201).json(copy);
    })
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing || existing.orgId !== req.org!.id) throw new NotFoundError(`Media ${req.params.id} not found`);
      const tags = Array.isArray(req.body?.tags) ? req.body.tags.map(String) : undefined;
      const updated = repo.update(req.params.id, { tags });
      res.json(updated);
    })
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing || existing.orgId !== req.org!.id) throw new NotFoundError(`Media ${req.params.id} not found`);
      deleteMediaFiles(existing);
      repo.delete(req.params.id);
      res.status(204).end();
    })
  );

  return router;
}
