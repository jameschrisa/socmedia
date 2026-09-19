import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import type { MediaAsset, PostFormat } from "@socmedia/shared";
import type { Db } from "../db/database";
import { MediaRepo } from "../db/repositories/media";
import { BadRequestError, NotFoundError } from "../middleware/errors";
import { copyMediaFiles, deleteMediaFiles, saveDataUrl, saveUploadBuffer } from "../services/media";
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
      const saved = await saveUploadBuffer(orgId, req.file.buffer, req.file.mimetype, req.file.originalname);
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
        tags: parseTags(req.body.tags),
        sourceAssetId: (req.body.sourceAssetId as string) || null,
        format: (req.body.format as PostFormat) || null,
        createdAt: now,
      };
      const created = repo.create(asset);
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
