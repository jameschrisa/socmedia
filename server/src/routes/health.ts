import { Router } from "express";
import type { Db } from "../db/database";
import { activeProvider } from "../services/aiSettings";
import { backupHealth } from "../services/backup";

const VERSION = "0.1.0";

export function healthRouter(db: Db): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    const ai = activeProvider(db);
    res.json({
      ok: true,
      version: VERSION,
      time: new Date().toISOString(),
      ai: { configured: ai.provider !== "mock", provider: ai.provider, model: ai.model },
      backup: backupHealth(),
    });
  });

  return router;
}
