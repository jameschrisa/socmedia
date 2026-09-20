import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { config } from "../config";
import type { Db } from "../db/database";
import { BadRequestError, NotFoundError } from "../middleware/errors";
import {
  BACKUP_NAME_RE,
  BackupInProgressError,
  backupStatus,
  isBackupRunning,
  listLocalBackups,
  runBackup,
} from "../services/backup";
import { log } from "../services/logger";
import { asyncHandler } from "../utils/asyncHandler";

function backupsDir(): string {
  return path.join(config.dataDir, "backups");
}

/** Validates `name` against the strict archive filename shape and resolves it inside the backups
 * directory; throws BadRequestError for anything malformed or that would escape the directory. */
function resolveBackupPath(name: string): string {
  if (!BACKUP_NAME_RE.test(name)) throw new BadRequestError("Invalid backup archive name");
  const dir = backupsDir();
  const resolved = path.resolve(dir, name);
  if (resolved !== path.join(dir, name) || !resolved.startsWith(dir + path.sep)) {
    throw new BadRequestError("Invalid backup archive name");
  }
  return resolved;
}

/** Manual and scheduled backup management. Mounted at /api/backups behind `requireRole("admin")` in app.ts. */
export function backupsRouter(db: Db): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      res.json({ status: backupStatus(), backups: listLocalBackups() });
    })
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      if (isBackupRunning()) {
        res.status(409).json({ error: "A backup is already running" });
        return;
      }
      try {
        const record = await runBackup(db, "manual");
        log.info("backup", "Manual backup triggered", { userId: req.user?.id, data: { name: record.name, ok: record.ok } });
        res.status(record.ok ? 201 : 500).json(record);
      } catch (err) {
        if (err instanceof BackupInProgressError) {
          res.status(409).json({ error: err.message });
          return;
        }
        throw err;
      }
    })
  );

  router.get(
    "/:name",
    asyncHandler(async (req, res) => {
      const filePath = resolveBackupPath(req.params.name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        throw new NotFoundError(`Backup ${req.params.name} not found`);
      }
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Length", String(stat.size));
      res.setHeader("Content-Disposition", `attachment; filename="${req.params.name}"`);
      fs.createReadStream(filePath).pipe(res);
    })
  );

  router.delete(
    "/:name",
    asyncHandler(async (req, res) => {
      const filePath = resolveBackupPath(req.params.name);
      try {
        fs.unlinkSync(filePath);
      } catch {
        throw new NotFoundError(`Backup ${req.params.name} not found`);
      }
      log.info("backup", "Backup deleted", { userId: req.user?.id, data: { name: req.params.name } });
      res.status(204).end();
    })
  );

  return router;
}
