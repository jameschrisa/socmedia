import { Router } from "express";
import { nanoid } from "nanoid";
import { hasErrors, postInputSchema, postUpdateSchema, validatePost } from "@socmedia/shared";
import type { Platform, Post, PostStatus } from "@socmedia/shared";
import type { Db } from "../db/database";
import { MediaRepo } from "../db/repositories/media";
import { PostsRepo } from "../db/repositories/posts";
import { BadRequestError, NotFoundError } from "../middleware/errors";
import { publishPost } from "../services/publisher";
import { asyncHandler } from "../utils/asyncHandler";

function parseStatusFilter(raw: unknown): PostStatus[] | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  return raw.split(",").map((s) => s.trim()) as PostStatus[];
}

export function postsRouter(db: Db): Router {
  const router = Router();
  const repo = new PostsRepo(db);
  const mediaRepo = new MediaRepo(db);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const orgId = req.org!.id;
      const posts = repo.listByOrg(orgId, {
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
        status: parseStatusFilter(req.query.status),
        platform: typeof req.query.platform === "string" ? (req.query.platform as Platform) : undefined,
        includeUnscheduled: req.query.includeUnscheduled === "1" || req.query.includeUnscheduled === "true",
      });
      res.json(posts);
    })
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const input = postInputSchema.parse(req.body);
      const now = new Date().toISOString();
      const status: PostStatus = input.status ?? (input.scheduledAt ? "scheduled" : "draft");
      const post = repo.create({
        id: nanoid(),
        orgId: req.org!.id,
        title: input.title,
        caption: input.caption,
        hashtags: input.hashtags,
        mediaIds: input.mediaIds,
        targets: input.targets,
        status,
        scheduledAt: input.scheduledAt ?? null,
        timezone: input.timezone,
        publishMode: input.publishMode,
        queueSpacingMinutes: input.queueSpacingMinutes,
        labels: input.labels,
        notes: input.notes,
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
      });
      res.status(201).json(post);
    })
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const post = repo.get(req.params.id);
      if (!post || post.orgId !== req.org!.id) throw new NotFoundError(`Post ${req.params.id} not found`);
      res.json(post);
    })
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing || existing.orgId !== req.org!.id) throw new NotFoundError(`Post ${req.params.id} not found`);
      const input = postUpdateSchema.parse(req.body);
      const updated: Post = {
        ...existing,
        ...input,
        scheduledAt: input.scheduledAt !== undefined ? input.scheduledAt : existing.scheduledAt,
        updatedAt: new Date().toISOString(),
      };
      const saved = repo.save(updated);
      res.json(saved);
    })
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing || existing.orgId !== req.org!.id) throw new NotFoundError(`Post ${req.params.id} not found`);
      repo.delete(req.params.id);
      res.status(204).end();
    })
  );

  router.post(
    "/:id/validate",
    asyncHandler(async (req, res) => {
      const post = repo.get(req.params.id);
      if (!post || post.orgId !== req.org!.id) throw new NotFoundError(`Post ${req.params.id} not found`);
      const media = mediaRepo.listByOrg(req.org!.id);
      const issues = validatePost(post, media);
      res.json({ issues });
    })
  );

  router.post(
    "/:id/schedule",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing || existing.orgId !== req.org!.id) throw new NotFoundError(`Post ${req.params.id} not found`);
      const scheduledAt = req.body?.scheduledAt;
      if (typeof scheduledAt !== "string") throw new BadRequestError("scheduledAt is required");

      const candidate: Post = { ...existing, scheduledAt };
      const media = mediaRepo.listByOrg(req.org!.id);
      const issues = validatePost(candidate, media);
      if (hasErrors(issues)) {
        res.status(400).json({ error: "Post is not valid for scheduling", issues });
        return;
      }
      const updated = repo.save({ ...candidate, status: "scheduled", updatedAt: new Date().toISOString() });
      res.json(updated);
    })
  );

  router.post(
    "/:id/publish",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing || existing.orgId !== req.org!.id) throw new NotFoundError(`Post ${req.params.id} not found`);
      const result = await publishPost(db, existing);
      res.json(result);
    })
  );

  router.post(
    "/:id/duplicate",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing || existing.orgId !== req.org!.id) throw new NotFoundError(`Post ${req.params.id} not found`);
      const now = new Date().toISOString();
      const duplicate = repo.create({
        ...existing,
        id: nanoid(),
        status: "draft",
        scheduledAt: null,
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      res.status(201).json(duplicate);
    })
  );

  router.post(
    "/:id/approve",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing || existing.orgId !== req.org!.id) throw new NotFoundError(`Post ${req.params.id} not found`);
      const status: PostStatus = existing.scheduledAt ? "scheduled" : "approved";
      const updated = repo.save({ ...existing, status, updatedAt: new Date().toISOString() });
      res.json(updated);
    })
  );

  return router;
}
