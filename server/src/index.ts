import path from "node:path";
import { createApp } from "./app";
import { config } from "./config";
import { openDatabase } from "./db/database";
import { seedIfEmpty } from "./db/seed";
import { ensureBootstrapAdmin } from "./services/auth";
import { log } from "./services/logger";
import { startScheduler } from "./services/scheduler";

async function main() {
  log.pruneOldFiles();

  const dbPath = path.join(config.dataDir, "pulse.db");
  const db = openDatabase(dbPath);
  ensureBootstrapAdmin(db);
  await seedIfEmpty(db);

  const app = createApp(db);
  const stopScheduler = startScheduler(db, config.schedulerIntervalMs);

  const server = app.listen(config.port, () => {
    log.info("system", `Pulse API listening on :${config.port}`, {
      data: { dataDir: config.dataDir, aiConfigured: !!config.anthropicApiKey },
    });
  });

  const shutdown = () => {
    stopScheduler();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("system", "Fatal startup error", { data: { error: err instanceof Error ? err.message : String(err) } });
  process.exit(1);
});
