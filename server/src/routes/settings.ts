import { Router } from "express";
import { z } from "zod";
import { aiSettingsUpdateSchema, publishingSettingsSchema, type PublishingSettings } from "@socmedia/shared";
import { SettingsRepo } from "../db/repositories/settings";
import type { Db } from "../db/database";
import { listModels, testProvider } from "../services/aiProviders";
import { getPublicAiSettings, saveAiSettings } from "../services/aiSettings";
import { log } from "../services/logger";
import { asyncHandler } from "../utils/asyncHandler";

const providerParam = z.object({ provider: z.enum(["anthropic", "moonshot"]) });

/** Workspace-wide settings (not org scoped). */
export function settingsRouter(db: Db): Router {
  const router = Router();

  const PUBLISHING_DEFAULTS: PublishingSettings = { defaultPublishMode: "all", queueSpacingMinutes: 10, warnOnDuplicateCaptions: true };
  const settingsRepo = new SettingsRepo(db);
  const getPublishing = (): PublishingSettings => ({ ...PUBLISHING_DEFAULTS, ...(settingsRepo.get<Partial<PublishingSettings>>("publishing")?.value ?? {}) });

  router.get("/publishing", (_req, res) => {
    res.json(getPublishing());
  });

  router.put(
    "/publishing",
    asyncHandler(async (req, res) => {
      const input = publishingSettingsSchema.parse(req.body);
      const next = { ...getPublishing(), ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } as PublishingSettings;
      settingsRepo.set("publishing", next);
      log.info("system", "Publishing settings updated", { userId: req.user?.id, data: { ...next } });
      res.json(next);
    })
  );

  router.get("/ai", (_req, res) => {
    res.json(getPublicAiSettings(db));
  });

  router.put(
    "/ai",
    asyncHandler(async (req, res) => {
      const input = aiSettingsUpdateSchema.parse(req.body);
      const saved = saveAiSettings(db, input);
      log.info("system", `AI settings updated (provider: ${saved.provider})`, { userId: req.user?.id, data: { provider: saved.provider } });
      res.json(saved);
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
