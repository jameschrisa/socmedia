import { Router } from "express";
import { z } from "zod";
import { aiSettingsUpdateSchema } from "@socmedia/shared";
import type { Db } from "../db/database";
import { listModels, testProvider } from "../services/aiProviders";
import { getPublicAiSettings, saveAiSettings } from "../services/aiSettings";
import { asyncHandler } from "../utils/asyncHandler";

const providerParam = z.object({ provider: z.enum(["anthropic", "moonshot"]) });

/** Workspace-wide settings (not org scoped). */
export function settingsRouter(db: Db): Router {
  const router = Router();

  router.get("/ai", (_req, res) => {
    res.json(getPublicAiSettings(db));
  });

  router.put(
    "/ai",
    asyncHandler(async (req, res) => {
      const input = aiSettingsUpdateSchema.parse(req.body);
      res.json(saveAiSettings(db, input));
    })
  );

  router.post(
    "/ai/test",
    asyncHandler(async (req, res) => {
      const { provider } = providerParam.parse(req.body);
      res.json(await testProvider(db, provider));
    })
  );

  router.get(
    "/ai/models",
    asyncHandler(async (req, res) => {
      const { provider } = providerParam.parse({ provider: req.query.provider });
      res.json({ provider, models: await listModels(db, provider) });
    })
  );

  return router;
}
