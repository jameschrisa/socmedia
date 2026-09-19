import { Router } from "express";
import type { Platform } from "@socmedia/shared";
import type { Db } from "../db/database";
import { MetricsRepo } from "../db/repositories/metrics";
import { summarize, syncAnalytics } from "../services/analytics";
import { asyncHandler } from "../utils/asyncHandler";

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function analyticsRouter(db: Db): Router {
  const router = Router();
  const metricsRepo = new MetricsRepo(db);

  router.get(
    "/summary",
    asyncHandler(async (req, res) => {
      const defaults = defaultRange();
      const from = typeof req.query.from === "string" ? req.query.from : defaults.from;
      const to = typeof req.query.to === "string" ? req.query.to : defaults.to;
      const platform = typeof req.query.platform === "string" ? (req.query.platform as Platform) : undefined;
      res.json(summarize(db, req.org!.id, from, to, platform));
    })
  );

  router.post(
    "/sync",
    asyncHandler(async (req, res) => {
      const synced = await syncAnalytics(db, req.org!.id);
      res.json({ synced });
    })
  );

  router.get(
    "/snapshots",
    asyncHandler(async (req, res) => {
      const platform = typeof req.query.platform === "string" ? (req.query.platform as Platform) : undefined;
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      res.json(metricsRepo.listByOrg(req.org!.id, { platform, from, to }));
    })
  );

  return router;
}
