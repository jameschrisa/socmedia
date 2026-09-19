import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { config } from "./config";
import type { Db } from "./db/database";
import { errorHandler } from "./middleware/errors";
import { orgMiddleware } from "./middleware/org";
import { aiRouter } from "./routes/ai";
import { analyticsRouter } from "./routes/analytics";
import { connectionsOAuthCallback, connectionsRouter } from "./routes/connections";
import { healthRouter } from "./routes/health";
import { jobsRouter } from "./routes/jobs";
import { mediaRouter } from "./routes/media";
import { orgsRouter } from "./routes/orgs";
import { postsRouter } from "./routes/posts";
import { settingsRouter } from "./routes/settings";

/** Builds the Express app (no listening) so tests can drive it with supertest directly. */
export function createApp(db: Db): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: config.clientUrl || true, credentials: true }));
  app.use(express.json({ limit: "25mb" }));

  fs.mkdirSync(path.join(config.dataDir, "uploads"), { recursive: true });
  app.use("/uploads", express.static(path.join(config.dataDir, "uploads")));

  app.use("/api", healthRouter(db));
  app.use("/api/settings", settingsRouter(db));
  app.use("/api", orgsRouter(db));

  // Not org-scoped: the OAuth provider redirects here directly and state encodes the connectionId.
  // Registered before the org-scoped /api/connections router so it isn't shadowed by "/:id".
  app.get("/api/connections/oauth/callback", connectionsOAuthCallback(db));

  const org = orgMiddleware(db);
  app.use("/api/connections", org, connectionsRouter(db));
  app.use("/api/media", org, mediaRouter(db));
  app.use("/api/posts", org, postsRouter(db));
  app.use("/api/jobs", org, jobsRouter(db));
  app.use("/api/analytics", org, analyticsRouter(db));
  app.use("/api/ai", org, aiRouter(db));

  if (config.nodeEnv === "production") {
    const clientDist = path.resolve(process.cwd(), "client", "dist");
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
        res.sendFile(path.join(clientDist, "index.html"));
      });
    }
  }

  app.use(errorHandler);
  return app;
}
