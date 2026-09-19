import { Router } from "express";
import type { JobStatus } from "@socmedia/shared";
import type { Db } from "../db/database";
import { JobsRepo } from "../db/repositories/jobs";
import { NotFoundError } from "../middleware/errors";
import { retryJob } from "../services/publisher";
import { asyncHandler } from "../utils/asyncHandler";

export function jobsRouter(db: Db): Router {
  const router = Router();
  const repo = new JobsRepo(db);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const orgId = req.org!.id;
      const limitRaw = req.query.limit;
      const limit = typeof limitRaw === "string" && Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : undefined;
      const jobs = repo.listByOrg(orgId, {
        postId: typeof req.query.postId === "string" ? req.query.postId : undefined,
        status: typeof req.query.status === "string" ? (req.query.status as JobStatus) : undefined,
        limit,
      });
      res.json(jobs);
    })
  );

  router.post(
    "/:id/retry",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing || existing.orgId !== req.org!.id) throw new NotFoundError(`Job ${req.params.id} not found`);
      const updated = await retryJob(db, req.params.id);
      res.json(updated);
    })
  );

  return router;
}
