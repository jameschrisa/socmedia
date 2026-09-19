import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import {
  PLATFORM_SPECS,
  quickPostFieldsSchema,
  quickPostTokenCreateSchema,
  quickPostTokenUpdateSchema,
} from "@socmedia/shared";
import type { MediaAsset, Platform, PlatformConnection, Post, PostFormat, QuickPostLink, QuickPostPublicInfo, QuickPostResult, QuickPostToken } from "@socmedia/shared";
import type { Db } from "../db/database";
import { ConnectionsRepo } from "../db/repositories/connections";
import { MediaRepo } from "../db/repositories/media";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { PostsRepo } from "../db/repositories/posts";
import type { QuickPostTokenRecord } from "../db/repositories/quickPostTokens";
import { QuickPostTokensRepo } from "../db/repositories/quickPostTokens";
import { BadRequestError, NotFoundError } from "../middleware/errors";
import { activeProvider } from "../services/aiSettings";
import { log } from "../services/logger";
import { publishPost } from "../services/publisher";
import {
  checkAndRecordRateLimit,
  generateQuickPostToken,
  hashQuickPostToken,
  resolveQuickCaption,
  saveMemoBuffer,
} from "../services/quickPost";
import { saveUploadBuffer } from "../services/media";
import { asyncHandler } from "../utils/asyncHandler";

function toPublicToken(record: QuickPostTokenRecord, secret?: string): QuickPostToken {
  return {
    id: record.id,
    orgId: record.orgId,
    userId: record.userId,
    label: record.label,
    token: secret,
    tokenPreview: record.tokenPreview,
    connectionIds: record.connectionIds,
    publishMode: record.publishMode,
    active: record.active,
    usesCount: record.usesCount,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt ?? null,
  };
}

/** Signed-in, org-scoped, write-role management of quick-post links (mounted at /api/quick/tokens). */
export function quickTokensRouter(db: Db): Router {
  const router = Router();
  const repo = new QuickPostTokensRepo(db);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json(repo.listByOrg(req.org!.id).map((r) => toPublicToken(r)));
    })
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const input = quickPostTokenCreateSchema.parse(req.body);
      const { secret, hash, preview } = generateQuickPostToken();
      const now = new Date().toISOString();
      const created = repo.create({
        id: nanoid(),
        orgId: req.org!.id,
        userId: req.user!.id,
        label: input.label,
        tokenHash: hash,
        tokenPreview: preview,
        connectionIds: input.connectionIds,
        publishMode: input.publishMode,
        createdAt: now,
      });
      log.info("quick", `Quick post link "${created.label}" created`, { orgId: req.org!.id, userId: req.user!.id, data: { tokenId: created.id } });
      res.status(201).json(toPublicToken(created, secret));
    })
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing || existing.orgId !== req.org!.id) throw new NotFoundError(`Quick post link ${req.params.id} not found`);
      const input = quickPostTokenUpdateSchema.parse(req.body);
      const updated = repo.update(existing.id, input)!;
      log.info("quick", `Quick post link "${updated.label}" updated`, { orgId: req.org!.id, userId: req.user!.id, data: { tokenId: updated.id } });
      res.json(toPublicToken(updated));
    })
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing || existing.orgId !== req.org!.id) throw new NotFoundError(`Quick post link ${req.params.id} not found`);
      repo.delete(existing.id);
      log.info("quick", `Quick post link "${existing.label}" deleted`, { orgId: req.org!.id, userId: req.user!.id, data: { tokenId: existing.id } });
      res.status(204).end();
    })
  );

  return router;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // upper bound; per-field limits are enforced in the handler
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === "image") {
      if (file.mimetype.startsWith("image/")) cb(null, true);
      else cb(new Error("image must be an image file"));
      return;
    }
    if (file.fieldname === "memo") {
      if (file.mimetype.startsWith("audio/")) cb(null, true);
      else cb(new Error("memo must be an audio file"));
      return;
    }
    cb(new Error(`Unexpected field "${file.fieldname}"`));
  },
}).fields([
  { name: "image", maxCount: 1 },
  { name: "memo", maxCount: 1 },
]);

function handleUpload(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const message = err instanceof multer.MulterError ? err.message : err instanceof Error ? err.message : "Invalid upload";
    next(new BadRequestError(message));
  });
}

/** Public (no session) quick-post-from-a-phone routes: the token secret is the credential. */
export function quickPublicRouter(db: Db): Router {
  const router = Router();
  const tokensRepo = new QuickPostTokensRepo(db);
  const orgsRepo = new OrganizationsRepo(db);
  const connectionsRepo = new ConnectionsRepo(db);
  const mediaRepo = new MediaRepo(db);
  const postsRepo = new PostsRepo(db);

  function resolveToken(rawToken: string): QuickPostTokenRecord | undefined {
    const record = tokensRepo.getByHash(hashQuickPostToken(rawToken));
    return record && record.active ? record : undefined;
  }

  const acceptsImage = (platform: Platform) => PLATFORM_SPECS[platform].mediaKinds.includes("image");

  function targetsFor(orgId: string, token: QuickPostTokenRecord): { connectionId: string; platform: Platform; format: PostFormat; mediaIds: string[] }[] {
    // Only accounts on platforms that accept a still image (quick posts are always a photo).
    const all = connectionsRepo.listByOrg(orgId).filter((c) => c.enabled && acceptsImage(c.platform));
    const chosen = token.connectionIds.length > 0 ? all.filter((c) => token.connectionIds.includes(c.id)) : all;
    return chosen.map((c) => ({ connectionId: c.id, platform: c.platform, format: PLATFORM_SPECS[c.platform].formats[0], mediaIds: [] }));
  }

  router.get(
    "/:token",
    asyncHandler(async (req, res) => {
      const record = resolveToken(req.params.token);
      if (!record) throw new NotFoundError("This link is invalid or has been deactivated");
      const org = orgsRepo.get(record.orgId);
      if (!org) throw new NotFoundError("This link is invalid or has been deactivated");

      const connections = connectionsRepo.listByOrg(org.id);
      const byId = new Map(connections.map((c) => [c.id, c]));
      const chosen: PlatformConnection[] =
        record.connectionIds.length > 0
          ? (record.connectionIds.map((id) => byId.get(id)).filter((c): c is PlatformConnection => !!c && c.enabled && acceptsImage(c.platform)))
          : connections.filter((c) => c.enabled && acceptsImage(c.platform));

      const info: QuickPostPublicInfo = {
        label: record.label,
        orgName: org.name,
        orgLogoUrl: org.logoUrl ?? null,
        brandColor: org.brandColor,
        targets: chosen.map((c) => ({ connectionId: c.id, platform: c.platform, label: c.label || null, handle: c.handle })),
        aiAvailable: activeProvider(db).provider !== "mock",
      };
      res.json(info);
    })
  );

  router.post(
    "/:token",
    handleUpload,
    asyncHandler(async (req, res) => {
      const record = resolveToken(req.params.token);
      if (!record) throw new NotFoundError("This link is invalid or has been deactivated");
      if (!checkAndRecordRateLimit(record.id)) {
        res.status(429).json({ error: "Too many submissions from this link recently. Try again in an hour." });
        return;
      }
      const org = orgsRepo.get(record.orgId);
      if (!org) throw new NotFoundError("This link is invalid or has been deactivated");

      const files = req.files as { image?: Express.Multer.File[]; memo?: Express.Multer.File[] } | undefined;
      const imageFile = files?.image?.[0];
      if (!imageFile) throw new BadRequestError("An image is required");
      if (imageFile.size > 15 * 1024 * 1024) throw new BadRequestError("Images must be 15MB or smaller");
      const memoFile = files?.memo?.[0];
      if (memoFile && memoFile.size > 20 * 1024 * 1024) throw new BadRequestError("Voice memos must be 20MB or smaller");

      const fields = quickPostFieldsSchema.parse(req.body ?? {});
      const now = new Date().toISOString();

      const savedImage = await saveUploadBuffer(org.id, imageFile.buffer, imageFile.mimetype, imageFile.originalname);
      const media: MediaAsset = mediaRepo.create({
        id: nanoid(),
        orgId: org.id,
        kind: savedImage.kind,
        filename: savedImage.filename,
        mimeType: savedImage.mimeType,
        size: savedImage.size,
        width: savedImage.width ?? null,
        height: savedImage.height ?? null,
        durationSeconds: null,
        url: savedImage.url,
        thumbnailUrl: savedImage.thumbnailUrl ?? null,
        tags: ["quick"],
        sourceAssetId: null,
        format: null,
        createdAt: now,
      });

      let memoUrl: string | null = null;
      if (memoFile) {
        memoUrl = saveMemoBuffer(org.id, memoFile.buffer, memoFile.mimetype).url;
      }

      const caption = (fields.caption ?? "").trim();
      const transcript = (fields.transcript ?? "").trim();
      const targets = targetsFor(org.id, record);

      let finalCaption = "";
      let hashtags: string[] = [];
      let captionSource: QuickPostResult["captionSource"] = "none";

      if (caption) {
        finalCaption = caption;
        captionSource = "caption";
      } else if (transcript) {
        const resolved = await resolveQuickCaption(db, transcript, fields.polish);
        finalCaption = resolved.caption;
        hashtags = resolved.hashtags;
        captionSource = resolved.captionSource;
      }

      if (!finalCaption) {
        const notesParts = ["Needs a caption (submitted from phone)"];
        if (memoUrl) notesParts.push(`Voice memo: ${memoUrl}`);
        const post: Post = postsRepo.create({
          id: nanoid(),
          orgId: org.id,
          title: "",
          caption: "",
          hashtags: [],
          mediaIds: [media.id],
          targets,
          status: "draft",
          scheduledAt: null,
          timezone: org.timezone,
          publishMode: record.publishMode,
          queueSpacingMinutes: 10,
          labels: ["quick"],
          notes: notesParts.join("\n"),
          createdAt: now,
          updatedAt: now,
          publishedAt: null,
        });
        tokensRepo.recordUse(record.id, now);
        const result: QuickPostResult = { post, media, status: "needs_caption", caption: "", captionSource: "none", links: [] };
        log.info("quick", `Quick post from "${record.label}" needs a caption`, {
          orgId: org.id,
          userId: record.userId,
          data: { postId: post.id, mediaId: media.id },
        });
        res.status(202).json(result);
        return;
      }

      const notesParts: string[] = [];
      if (memoUrl) notesParts.push(`Voice memo: ${memoUrl}`);
      const draft: Post = postsRepo.create({
        id: nanoid(),
        orgId: org.id,
        title: finalCaption.slice(0, 60),
        caption: finalCaption,
        hashtags,
        mediaIds: [media.id],
        targets,
        status: "draft",
        scheduledAt: null,
        timezone: org.timezone,
        publishMode: record.publishMode,
        queueSpacingMinutes: 10,
        labels: ["quick"],
        notes: notesParts.join("\n"),
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
      });

      const { post: publishedPost, jobs } = await publishPost(db, draft);
      const connections = connectionsRepo.listByOrg(org.id);
      const labelById = new Map(connections.map((c) => [c.id, c.label || null]));
      const jobByConnection = new Map(jobs.map((j) => [j.connectionId, j]));
      const links: QuickPostLink[] = targets.map((t) => {
        const job = jobByConnection.get(t.connectionId);
        return {
          connectionId: t.connectionId,
          platform: t.platform,
          label: labelById.get(t.connectionId) ?? null,
          status: job?.status ?? "queued",
          url: job?.externalUrl ?? null,
          error: job?.error ?? null,
        };
      });

      tokensRepo.recordUse(record.id, now);
      log.info("quick", `Quick post from "${record.label}" published`, {
        orgId: org.id,
        userId: record.userId,
        data: { postId: publishedPost.id, links },
      });

      const result: QuickPostResult = {
        post: publishedPost,
        media,
        status: publishedPost.status,
        caption: finalCaption,
        captionSource,
        links,
      };
      res.status(201).json(result);
    })
  );

  return router;
}
