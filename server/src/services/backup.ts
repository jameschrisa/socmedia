import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../config";
import type { Db } from "../db/database";
import { log } from "./logger";

const execFileAsync = promisify(execFile);

/** `suprstar-YYYYMMDD-HHMMSS.tar.gz`, matched strictly everywhere a name comes back from a client. */
export const BACKUP_NAME_RE = /^suprstar-(\d{8})-(\d{6})\.tar\.gz$/;

export interface BackupOffsiteResult {
  attempted: boolean;
  ok: boolean;
  key?: string;
  error?: string | null;
}

export interface BackupRecord {
  name: string;
  /** ISO timestamp, parsed from the filename (or file mtime as a fallback for pre-existing archives). */
  createdAt: string;
  sizeBytes: number;
  /** "manual" | "scheduled" | "unknown" (unknown: derived from disk with no run metadata attached). */
  reason: string;
  ok: boolean;
  durationMs: number;
  error?: string | null;
  offsite: BackupOffsiteResult;
}

export interface BackupStatus {
  lastAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  lastSizeBytes: number | null;
  lastDurationMs: number | null;
  ageHours: number | null;
  local: { count: number; newest: string | null; totalBytes: number };
  offsite: { configured: boolean; lastUploadedAt: string | null; lastError: string | null };
}

/** Thrown by `runBackup` when a backup is already in flight; routes/scheduler map this to a no-op / 409. */
export class BackupInProgressError extends Error {
  constructor() {
    super("A backup is already running");
    this.name = "BackupInProgressError";
  }
}

interface BackupState {
  lastAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  lastSizeBytes: number | null;
  lastDurationMs: number | null;
  offsiteLastUploadedAt: string | null;
  offsiteLastError: string | null;
}

function emptyState(): BackupState {
  return {
    lastAt: null,
    lastOk: null,
    lastError: null,
    lastSizeBytes: null,
    lastDurationMs: null,
    offsiteLastUploadedAt: null,
    offsiteLastError: null,
  };
}

let state: BackupState = emptyState();
let inFlight = false;

export function isBackupRunning(): boolean {
  return inFlight;
}

/** Test-only: clears in-memory run state and the in-flight flag between tests that swap `config.dataDir`. */
export function _resetBackupStateForTests(): void {
  state = emptyState();
  inFlight = false;
}

function backupsDir(): string {
  return path.join(config.dataDir, "backups");
}

function uploadsDir(): string {
  return path.join(config.dataDir, "uploads");
}

function s3Configured(): boolean {
  return !!config.backupS3Bucket;
}

/** Parses "suprstar-YYYYMMDD-HHMMSS.tar.gz" into an ISO timestamp (the name encodes UTC). */
function timestampFromName(name: string): string | null {
  const m = BACKUP_NAME_RE.exec(name);
  if (!m) return null;
  const [, d, t] = m;
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}.000Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function nameForTimestamp(now: Date): string {
  const iso = now.toISOString(); // "2026-09-20T12:34:56.000Z"
  const date = iso.slice(0, 10).replace(/-/g, "");
  const time = iso.slice(11, 19).replace(/:/g, "");
  return `suprstar-${date}-${time}.tar.gz`;
}

/** Local archives, newest first, derived straight from the backups directory (survives process restarts). */
export function listLocalBackups(): BackupRecord[] {
  const dir = backupsDir();
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => BACKUP_NAME_RE.test(n));
  } catch {
    return [];
  }
  const records: BackupRecord[] = names.map((name) => {
    const stat = fs.statSync(path.join(dir, name));
    return {
      name,
      createdAt: timestampFromName(name) ?? stat.mtime.toISOString(),
      sizeBytes: stat.size,
      reason: "unknown",
      ok: true,
      durationMs: 0,
      error: null,
      offsite: { attempted: false, ok: false, error: null },
    };
  });
  records.sort((a, b) => (a.name < b.name ? 1 : -1));
  return records;
}

function pruneLocal(): void {
  const records = listLocalBackups(); // newest first
  if (records.length <= config.backupKeep) return;
  const toDelete = records.slice(config.backupKeep);
  for (const rec of toDelete) {
    try {
      fs.unlinkSync(path.join(backupsDir(), rec.name));
    } catch {
      // best effort; a file already gone is not an error
    }
  }
  log.info("backup", `Pruned ${toDelete.length} old backup(s)`, {
    data: { pruned: toDelete.map((r) => r.name), kept: config.backupKeep },
  });
}

async function uploadOffsite(archivePath: string, name: string): Promise<BackupOffsiteResult> {
  const prefix = config.backupS3Prefix.replace(/^\/+|\/+$/g, "");
  const key = prefix ? `${prefix}/${name}` : name;
  const body = fs.createReadStream(archivePath);
  // A stream that's never consumed (a mocked `send()` in tests, or a client.send() that throws before
  // reading Body) must not crash the process with an unhandled "error" event.
  body.on("error", () => {});
  try {
    const client = new S3Client({
      region: config.backupS3Region || "auto",
      endpoint: config.backupS3Endpoint || undefined,
      forcePathStyle: !!config.backupS3Endpoint,
      credentials: config.backupS3AccessKeyId
        ? { accessKeyId: config.backupS3AccessKeyId, secretAccessKey: config.backupS3SecretAccessKey }
        : undefined,
    });
    const size = fs.statSync(archivePath).size;
    await client.send(
      new PutObjectCommand({
        Bucket: config.backupS3Bucket,
        Key: key,
        Body: body,
        ContentType: "application/gzip",
        ContentLength: size,
      })
    );
    log.info("backup", "Offsite upload succeeded", { data: { name, key, bucket: config.backupS3Bucket } });
    return { attempted: true, ok: true, key, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A failed upload must never fail the backup as a whole: the local archive is still worth keeping.
    log.error("backup", "Offsite upload failed; local archive kept", { data: { name, key, error: message } });
    return { attempted: true, ok: false, key, error: message };
  } finally {
    // Belt and braces: if `send()` failed or was mocked without ever reading the body, this stream
    // would otherwise sit on an open (or not-yet-open) file descriptor indefinitely.
    if (!body.destroyed) body.destroy();
  }
}

/**
 * Writes a consistent snapshot of `db` (via `VACUUM INTO`) plus the uploads tree into one gzipped tar
 * under `<dataDir>/backups`, rotates old local archives, and uploads offsite when S3 storage is configured.
 * Never throws for an offsite failure; a thrown error means the local archive itself could not be produced.
 */
export async function createBackup(db: Db, opts: { reason: string }): Promise<BackupRecord> {
  const start = Date.now();
  const now = new Date();
  const name = nameForTimestamp(now);
  const dir = backupsDir();
  fs.mkdirSync(dir, { recursive: true });
  const archivePath = path.join(dir, name);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "suprstar-backup-"));
  const snapshotPath = path.join(tmpDir, "db.sqlite");

  log.info("backup", `Backup starting (${opts.reason})`, { data: { reason: opts.reason, name } });

  let ok = true;
  let error: string | null = null;
  try {
    db.prepare("VACUUM INTO ?").run(snapshotPath);

    const uploads = uploadsDir();
    fs.mkdirSync(uploads, { recursive: true });

    // Absolute -C targets: bsdtar (macOS dev) resolves a second relative -C against the first, GNU tar
    // (the Debian runtime image) doesn't need this but tolerates it fine, so absolute paths work on both.
    // --exclude guards against ever nesting a previous backups/logs dir even if this changes later.
    await execFileAsync("tar", [
      "-czf",
      archivePath,
      "--exclude=backups",
      "--exclude=logs",
      "-C",
      tmpDir,
      "db.sqlite",
      "-C",
      config.dataDir,
      "uploads",
    ]);
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }

  let sizeBytes = 0;
  if (ok) {
    try {
      sizeBytes = fs.statSync(archivePath).size;
    } catch (err) {
      ok = false;
      error = err instanceof Error ? err.message : String(err);
    }
  }

  const durationMs = Date.now() - start;

  if (ok) {
    log.info("backup", `Backup succeeded (${opts.reason})`, { data: { name, sizeBytes, durationMs } });
  } else {
    log.error("backup", `Backup failed (${opts.reason})`, { data: { name, error, durationMs } });
  }

  state = {
    ...state,
    lastAt: now.toISOString(),
    lastOk: ok,
    lastError: error,
    lastSizeBytes: ok ? sizeBytes : null,
    lastDurationMs: durationMs,
  };

  let offsite: BackupOffsiteResult = { attempted: false, ok: false, error: null };
  if (ok && s3Configured()) {
    offsite = await uploadOffsite(archivePath, name);
    state.offsiteLastError = offsite.error ?? null;
    if (offsite.ok) state.offsiteLastUploadedAt = new Date().toISOString();
  }

  if (ok) pruneLocal();

  return {
    name,
    createdAt: now.toISOString(),
    sizeBytes,
    reason: opts.reason,
    ok,
    durationMs,
    error,
    offsite,
  };
}

/** Guards `createBackup` with a shared in-flight flag so a manual trigger and the scheduler never overlap. */
export async function runBackup(db: Db, reason: string): Promise<BackupRecord> {
  if (inFlight) throw new BackupInProgressError();
  inFlight = true;
  try {
    return await createBackup(db, { reason });
  } finally {
    inFlight = false;
  }
}

/** `{ lastAt, lastOk, ... }` from memory when this process has run a backup, else derived from the newest
 * local archive so status survives a restart; `local`/`offsite.configured` are always read fresh. */
export function backupStatus(): BackupStatus {
  const local = listLocalBackups(); // newest first
  const totalBytes = local.reduce((sum, r) => sum + r.sizeBytes, 0);
  const newest = local[0] ?? null;

  const lastAt = state.lastAt ?? newest?.createdAt ?? null;
  const lastOk = state.lastAt ? state.lastOk : newest ? true : null;
  const lastError = state.lastAt ? state.lastError : null;
  const lastSizeBytes = state.lastAt ? state.lastSizeBytes : (newest?.sizeBytes ?? null);
  const lastDurationMs = state.lastAt ? state.lastDurationMs : null;
  const ageHours = lastAt ? (Date.now() - Date.parse(lastAt)) / 3_600_000 : null;

  return {
    lastAt,
    lastOk,
    lastError,
    lastSizeBytes,
    lastDurationMs,
    ageHours,
    local: { count: local.length, newest: newest?.name ?? null, totalBytes },
    offsite: {
      configured: s3Configured(),
      lastUploadedAt: state.offsiteLastUploadedAt,
      lastError: state.offsiteLastError,
    },
  };
}

/** Cheap health signal: false when the newest backup is stale (>= 2x the interval) or the last run failed. */
export function backupHealth(): { lastAt: string | null; ageHours: number | null; ok: boolean } {
  const status = backupStatus();
  const staleAfterHours = config.backupIntervalHours * 2;
  const stale = status.ageHours == null || status.ageHours >= staleAfterHours;
  const ok = status.lastOk !== false && !stale;
  return { lastAt: status.lastAt, ageHours: status.ageHours, ok };
}

/** Starts the background scheduler: checks (immediately, then every `intervalMs`) whether the newest
 * archive is older than `config.backupIntervalHours` and runs one if so. Returns a function that stops it.
 * A no-op when `config.backupEnabled` is false (tests, local dev). */
export function startBackupScheduler(db: Db, intervalMs: number): () => void {
  if (!config.backupEnabled) {
    return () => {};
  }

  const tick = async () => {
    try {
      const status = backupStatus();
      const due = status.local.count === 0 || status.ageHours == null || status.ageHours >= config.backupIntervalHours;
      if (!due) return;
      await runBackup(db, "scheduled");
    } catch (err) {
      if (err instanceof BackupInProgressError) return;
      log.error("backup", "Scheduled backup tick failed", { data: { error: err instanceof Error ? err.message : String(err) } });
    }
  };

  // Runs once right away: this is what makes catch-up-after-restart work without waiting a full interval.
  tick().catch(() => {});
  const timer = setInterval(() => {
    tick().catch(() => {});
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}
