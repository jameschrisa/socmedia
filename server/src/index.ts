import http from "node:http";
import path from "node:path";
import { createApp } from "./app";
import { config } from "./config";
import { openDatabase } from "./db/database";
import { seedIfEmpty } from "./db/seed";
import { attachTerminalServer } from "./routes/terminal";
import { ensureBootstrapAdmin } from "./services/auth";
import { startBackupScheduler } from "./services/backup";
import { log } from "./services/logger";
import { ensureRootAdmins } from "./services/rootAdmins";
import { startScheduler } from "./services/scheduler";

async function main() {
  log.pruneOldFiles();

  const dbPath = path.join(config.dataDir, "pulse.db");
  const db = openDatabase(dbPath);
  ensureBootstrapAdmin(db);
  await seedIfEmpty(db);
  // After seeding, so a first boot has its organizations before root administrators are created.
  ensureRootAdmins(db);

  const app = createApp(db);
  const stopScheduler = startScheduler(db, config.schedulerIntervalMs);
  // Checks hourly whether the newest backup is older than BACKUP_INTERVAL_HOURS and runs one if so;
  // also runs an immediate catch-up check on boot (see services/backup.ts).
  const stopBackupScheduler = startBackupScheduler(db, 60 * 60 * 1000);

  // Created explicitly (rather than app.listen) so the WebSocket terminal endpoint can hook the
  // http.Server's "upgrade" event directly; createApp stays a plain Express app for supertest.
  const server = http.createServer(app);
  attachTerminalServer(server, db);

  server.listen(config.port, () => {
    log.info("system", `Pulse API listening on :${config.port}`, {
      data: { dataDir: config.dataDir, aiConfigured: !!config.anthropicApiKey, osTerminal: config.osTerminal },
    });
  });

  const shutdown = () => {
    stopScheduler();
    stopBackupScheduler();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("system", "Fatal startup error", { data: { error: err instanceof Error ? err.message : String(err) } });
  process.exit(1);
});
