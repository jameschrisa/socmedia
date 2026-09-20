#!/usr/bin/env node
/**
 * Restores a suprstar backup archive (see docs/API.md "Backups") into a data directory.
 *
 * Usage:
 *   node scripts/restore-backup.mjs <archive.tar.gz> <dataDir> --force
 *   node scripts/restore-backup.mjs <archive.tar.gz> <dataDir> --dry-run
 *
 * Refuses to touch anything unless --force is passed (or --dry-run, which never touches the real
 * data directory at all). The existing data directory is renamed aside as "<dataDir>.pre-restore-
 * <timestamp>" rather than deleted, so a bad restore is itself recoverable. Restart the service after
 * a real (non-dry-run) restore.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { DatabaseSync } = await import("node:sqlite");

function timestampSuffix(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

/** rename(), falling back to copy+remove when the temp dir and target live on different filesystems. */
function moveDir(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

/** Runs the restore; returns a process exit code. All early-outs are plain `return`s so the caller's
 * `finally` always cleans up the temp extraction directory (unlike `process.exit`, which skips it). */
async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positional = args.filter((a) => !a.startsWith("--"));
  const dryRun = flags.has("--dry-run");
  const force = flags.has("--force");
  const [archiveArg, dataDirArg] = positional;

  const usage = "Usage: node scripts/restore-backup.mjs <archive.tar.gz> <dataDir> [--force] [--dry-run]";
  if (!archiveArg || !dataDirArg) {
    console.error(`Error: archive path and target data directory are required\n\n${usage}`);
    return 1;
  }
  if (!dryRun && !force) {
    console.error(`Error: refusing to restore without --force (pass --dry-run to preview instead)\n\n${usage}`);
    return 1;
  }

  const archivePath = path.resolve(archiveArg);
  const targetDataDir = path.resolve(dataDirArg);
  if (!fs.existsSync(archivePath)) {
    console.error(`Error: archive not found: ${archivePath}`);
    return 1;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "suprstar-restore-"));
  try {
    console.log(`Extracting ${archivePath} -> ${tmpDir}`);
    execFileSync("tar", ["-xzf", archivePath, "-C", tmpDir], { stdio: "inherit" });

    const dbPath = path.join(tmpDir, "db.sqlite");
    if (!fs.existsSync(dbPath)) {
      console.error(`Error: archive did not contain db.sqlite (looked at ${dbPath})`);
      return 1;
    }

    let tables;
    let orgCount;
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
      if (!tables.includes("organizations")) {
        console.error('Error: db.sqlite has no "organizations" table — this does not look like a suprstar database.');
        return 1;
      }
      orgCount = db.prepare("SELECT COUNT(*) AS n FROM organizations").get().n;
    } finally {
      db.close();
    }

    const uploadsPath = path.join(tmpDir, "uploads");
    const hasUploads = fs.existsSync(uploadsPath);

    console.log(`Sanity check passed: db.sqlite opens, ${tables.length} table(s), organizations table has ${orgCount} row(s).`);
    console.log(`Archive ${hasUploads ? "includes" : "does not include"} an uploads/ tree.`);

    const targetExists = fs.existsSync(targetDataDir);
    const asideDir = `${targetDataDir}.pre-restore-${timestampSuffix()}`;

    if (dryRun) {
      console.log("\n--dry-run: no changes made. This run would have:");
      if (targetExists) console.log(`  1. Moved ${targetDataDir} -> ${asideDir}`);
      else console.log(`  1. (${targetDataDir} does not exist yet, nothing to move aside)`);
      console.log(`  2. Created ${targetDataDir}`);
      console.log(`  3. Restored db.sqlite -> ${path.join(targetDataDir, "pulse.db")}`);
      console.log(
        `  4. Restored uploads/ -> ${path.join(targetDataDir, "uploads")}${hasUploads ? "" : " (skipped: archive has none)"}`
      );
      console.log("  5. Reminded you to restart the service.");
      return 0;
    }

    if (targetExists) {
      moveDir(targetDataDir, asideDir);
      console.log(`Moved existing data directory aside: ${targetDataDir} -> ${asideDir}`);
    } else {
      console.log(`${targetDataDir} did not exist yet; nothing to move aside.`);
    }

    fs.mkdirSync(targetDataDir, { recursive: true });
    // The archive always stores the snapshot as "db.sqlite"; the running server expects "pulse.db"
    // (see server/src/index.ts) at the top of its data directory.
    moveDir(dbPath, path.join(targetDataDir, "pulse.db"));
    console.log(`Restored database -> ${path.join(targetDataDir, "pulse.db")}`);

    if (hasUploads) {
      moveDir(uploadsPath, path.join(targetDataDir, "uploads"));
      console.log(`Restored uploads -> ${path.join(targetDataDir, "uploads")}`);
    } else {
      fs.mkdirSync(path.join(targetDataDir, "uploads"), { recursive: true });
      console.log("Archive had no uploads/ tree; created an empty one.");
    }

    console.log(`\nDone. Restored "${path.basename(archivePath)}" into ${targetDataDir}.`);
    console.log(`Previous data directory (if any) preserved at ${targetExists ? asideDir : "(none)"}.`);
    console.log("Restart the suprstar service now for it to pick up the restored data.");
    return 0;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

const code = await main();
process.exit(code);
