import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../config";
import { openDatabase } from "../db/database";
import { ensureUploadsDir } from "../services/media";
import { cleanupTestContext, createTestContext, TEST_OWNER_PASSWORD, type TestContext } from "./testApp";

const execFileAsync = promisify(execFile);

const { sendMock, putObjectCommandMock, s3ClientMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  putObjectCommandMock: vi.fn((input: unknown) => input),
  s3ClientMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: s3ClientMock.mockImplementation(() => ({ send: sendMock })),
  PutObjectCommand: putObjectCommandMock,
}));

// Imported after the mock so backup.ts picks up the mocked S3 client.
const {
  BACKUP_NAME_RE,
  backupHealth,
  backupStatus,
  createBackup,
  isBackupRunning,
  listLocalBackups,
  runBackup,
  startBackupScheduler,
  _resetBackupStateForTests,
} = await import("../services/backup");

async function extractArchive(archivePath: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-extract-"));
  await execFileAsync("tar", ["-xzf", archivePath, "-C", dir]);
  return dir;
}

describe("backups", () => {
  let ctx: TestContext;
  const originalBackupConfig = {
    backupEnabled: config.backupEnabled,
    backupIntervalHours: config.backupIntervalHours,
    backupKeep: config.backupKeep,
    backupS3Bucket: config.backupS3Bucket,
    backupS3Region: config.backupS3Region,
    backupS3Endpoint: config.backupS3Endpoint,
    backupS3AccessKeyId: config.backupS3AccessKeyId,
    backupS3SecretAccessKey: config.backupS3SecretAccessKey,
    backupS3Prefix: config.backupS3Prefix,
  };

  beforeEach(() => {
    ctx = createTestContext();
    _resetBackupStateForTests();
    sendMock.mockReset();
    putObjectCommandMock.mockClear();
    s3ClientMock.mockClear();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
    _resetBackupStateForTests();
    Object.assign(config, originalBackupConfig);
  });

  it("writes a gzipped tar containing db.sqlite and the uploads tree", async () => {
    const dir = ensureUploadsDir(ctx.orgId);
    fs.writeFileSync(path.join(dir, "photo.png"), "fake-image-bytes");

    const record = await createBackup(ctx.db, { reason: "manual" });
    expect(record.ok).toBe(true);
    expect(record.name).toMatch(BACKUP_NAME_RE);
    expect(record.sizeBytes).toBeGreaterThan(0);

    const archivePath = path.join(ctx.dataDir, "backups", record.name);
    expect(fs.existsSync(archivePath)).toBe(true);

    const extractDir = await extractArchive(archivePath);
    try {
      expect(fs.existsSync(path.join(extractDir, "db.sqlite"))).toBe(true);
      expect(fs.existsSync(path.join(extractDir, "uploads", ctx.orgId, "photo.png"))).toBe(true);
      expect(fs.existsSync(path.join(extractDir, "backups"))).toBe(false);
      expect(fs.existsSync(path.join(extractDir, "logs"))).toBe(false);
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  });

  it("the restored snapshot opens and has the expected tables and matching row counts", async () => {
    const record = await createBackup(ctx.db, { reason: "manual" });
    const archivePath = path.join(ctx.dataDir, "backups", record.name);
    const extractDir = await extractArchive(archivePath);
    try {
      const restored = openDatabase(path.join(extractDir, "db.sqlite"));
      const tables = (restored.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (r) => r.name
      );
      expect(tables).toEqual(expect.arrayContaining(["organizations", "connections", "posts", "users"]));

      const restoredOrgCount = (restored.prepare("SELECT COUNT(*) AS n FROM organizations").get() as { n: number }).n;
      const liveOrgCount = (ctx.db.prepare("SELECT COUNT(*) AS n FROM organizations").get() as { n: number }).n;
      expect(restoredOrgCount).toBe(liveOrgCount);
      expect(restoredOrgCount).toBeGreaterThan(0);

      const restoredUserCount = (restored.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
      const liveUserCount = (ctx.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
      expect(restoredUserCount).toBe(liveUserCount);
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  });

  it("keeps exactly BACKUP_KEEP local archives, deleting the oldest first", async () => {
    config.backupKeep = 3;
    const dir = path.join(ctx.dataDir, "backups");
    fs.mkdirSync(dir, { recursive: true });
    const fakeOldNames = [
      "suprstar-20260101-000000.tar.gz",
      "suprstar-20260102-000000.tar.gz",
      "suprstar-20260103-000000.tar.gz",
      "suprstar-20260104-000000.tar.gz",
    ];
    for (const name of fakeOldNames) fs.writeFileSync(path.join(dir, name), "placeholder");

    const record = await createBackup(ctx.db, { reason: "manual" }); // newest by far (today's real date)
    expect(record.ok).toBe(true);

    const remainingNames = listLocalBackups().map((r) => r.name);
    expect(remainingNames.length).toBe(3);
    expect(remainingNames).toContain(record.name);
    expect(remainingNames).toContain("suprstar-20260104-000000.tar.gz");
    expect(remainingNames).toContain("suprstar-20260103-000000.tar.gz");
    expect(remainingNames).not.toContain("suprstar-20260102-000000.tar.gz");
    expect(remainingNames).not.toContain("suprstar-20260101-000000.tar.gz");
  });

  it("reports age/size/count in status, and records a failed run without throwing or losing older archives", async () => {
    const good = await createBackup(ctx.db, { reason: "manual" });
    expect(good.ok).toBe(true);

    let status = backupStatus();
    expect(status.local.count).toBe(1);
    expect(status.local.newest).toBe(good.name);
    expect(status.lastSizeBytes).toBe(good.sizeBytes);
    expect(status.lastOk).toBe(true);
    expect(status.ageHours).not.toBeNull();
    expect(status.ageHours as number).toBeGreaterThanOrEqual(0);
    expect(backupHealth().ok).toBe(true);

    // Force the archive step to fail (no `tar` binary reachable) without touching the good archive.
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const failed = await createBackup(ctx.db, { reason: "manual" });
      expect(failed.ok).toBe(false);
      expect(failed.error).toBeTruthy();
    } finally {
      process.env.PATH = originalPath;
    }

    // the earlier good archive must still be there; a failed run never prunes or deletes anything
    expect(listLocalBackups().some((r) => r.name === good.name)).toBe(true);

    status = backupStatus();
    expect(status.lastOk).toBe(false);
    expect(backupHealth().ok).toBe(false);

    // staleness: with the interval effectively zero, any elapsed time makes the newest archive "stale"
    _resetBackupStateForTests();
    config.backupIntervalHours = 0;
    expect(backupHealth().ok).toBe(false);
  });

  it("runBackup rejects a concurrent call with BackupInProgressError-shaped state (isBackupRunning)", async () => {
    expect(isBackupRunning()).toBe(false);
    const first = runBackup(ctx.db, "manual");
    expect(isBackupRunning()).toBe(true);
    await expect(runBackup(ctx.db, "manual")).rejects.toThrow(/already running/);
    await first;
    expect(isBackupRunning()).toBe(false);
  });

  describe("scheduler", () => {
    beforeEach(() => {
      config.backupEnabled = true;
    });

    it("runs a backup immediately when none exists yet", async () => {
      const stop = startBackupScheduler(ctx.db, 50);
      try {
        await vi.waitFor(
          () => {
            expect(listLocalBackups().length).toBe(1);
          },
          { timeout: 5000, interval: 25 }
        );
      } finally {
        stop();
      }
    });

    it("skips running when a fresh archive already exists", async () => {
      config.backupIntervalHours = 24;
      const dir = path.join(ctx.dataDir, "backups");
      fs.mkdirSync(dir, { recursive: true });
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const freshName = `suprstar-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(
        now.getUTCHours()
      )}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}.tar.gz`;
      fs.writeFileSync(path.join(dir, freshName), "placeholder");

      const stop = startBackupScheduler(ctx.db, 50);
      try {
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(listLocalBackups().map((r) => r.name)).toEqual([freshName]);
      } finally {
        stop();
      }
    });

    it("is a no-op when BACKUP_ENABLED is false", () => {
      config.backupEnabled = false;
      const stop = startBackupScheduler(ctx.db, 50);
      stop();
      expect(listLocalBackups().length).toBe(0);
    });
  });

  describe("offsite upload", () => {
    beforeEach(() => {
      config.backupS3Bucket = "test-bucket";
      config.backupS3Prefix = "suprstar-prefix";
    });

    it("uploads to the expected key and records success", async () => {
      sendMock.mockResolvedValueOnce({});
      const record = await createBackup(ctx.db, { reason: "manual" });
      expect(record.ok).toBe(true);
      expect(record.offsite.attempted).toBe(true);
      expect(record.offsite.ok).toBe(true);
      expect(record.offsite.key).toBe(`suprstar-prefix/${record.name}`);
      expect(putObjectCommandMock).toHaveBeenCalledWith(
        expect.objectContaining({ Bucket: "test-bucket", Key: `suprstar-prefix/${record.name}` })
      );

      const status = backupStatus();
      expect(status.offsite.configured).toBe(true);
      expect(status.offsite.lastUploadedAt).not.toBeNull();
      expect(status.offsite.lastError).toBeNull();
    });

    it("a failed upload does not fail the backup and leaves the local archive plus a recorded error", async () => {
      sendMock.mockRejectedValueOnce(new Error("network is down"));
      const record = await createBackup(ctx.db, { reason: "manual" });
      expect(record.ok).toBe(true); // local archive still succeeded
      expect(record.offsite.attempted).toBe(true);
      expect(record.offsite.ok).toBe(false);
      expect(record.offsite.error).toContain("network is down");

      const archivePath = path.join(ctx.dataDir, "backups", record.name);
      expect(fs.existsSync(archivePath)).toBe(true);

      const status = backupStatus();
      expect(status.offsite.lastError).toContain("network is down");
    });
  });

  describe("routes", () => {
    beforeEach(() => {
      ctx.disableAuthBypass();
    });

    it("owner can list, create and delete; viewer and editor get 403", async () => {
      const ownerAgent = request.agent(ctx.app);
      await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
      await ownerAgent
        .post("/api/users")
        .send({ email: "editor@test.local", name: "Editor", role: "editor", orgIds: "*", password: "password123" });
      await ownerAgent
        .post("/api/users")
        .send({ email: "viewer@test.local", name: "Viewer", role: "viewer", orgIds: "*", password: "password123" });

      const editorAgent = request.agent(ctx.app);
      await editorAgent.post("/api/auth/login").send({ email: "editor@test.local", password: "password123" });
      const viewerAgent = request.agent(ctx.app);
      await viewerAgent.post("/api/auth/login").send({ email: "viewer@test.local", password: "password123" });

      expect((await editorAgent.get("/api/backups")).status).toBe(403);
      expect((await viewerAgent.get("/api/backups")).status).toBe(403);
      expect((await editorAgent.post("/api/backups")).status).toBe(403);

      const empty = await ownerAgent.get("/api/backups");
      expect(empty.status).toBe(200);
      expect(empty.body.backups).toEqual([]);
      expect(empty.body.status.local.count).toBe(0);

      const created = await ownerAgent.post("/api/backups");
      expect(created.status).toBe(201);
      expect(created.body.name).toMatch(BACKUP_NAME_RE);
      expect(created.body.ok).toBe(true);

      const listed = await ownerAgent.get("/api/backups");
      expect(listed.body.backups.length).toBe(1);
      expect(listed.body.backups[0].name).toBe(created.body.name);

      const download = await ownerAgent.get(`/api/backups/${created.body.name}`);
      expect(download.status).toBe(200);
      expect(download.headers["content-type"]).toBe("application/gzip");
      expect(download.headers["content-disposition"]).toContain("attachment");

      const del = await ownerAgent.delete(`/api/backups/${created.body.name}`);
      expect(del.status).toBe(204);
      const afterDelete = await ownerAgent.get("/api/backups");
      expect(afterDelete.body.backups).toEqual([]);
    });

    it("returns 409 when a backup is already running", async () => {
      const ownerAgent = request.agent(ctx.app);
      await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });

      // Sets isBackupRunning() true synchronously (before its first await), so the HTTP request below
      // is guaranteed to see it, unlike racing two real HTTP requests against each other.
      const inFlight = runBackup(ctx.db, "manual");
      const res = await ownerAgent.post("/api/backups");
      expect(res.status).toBe(409);
      await inFlight;
    });

    it("rejects a traversal name with 400 and an unknown name with 404", async () => {
      const ownerAgent = request.agent(ctx.app);
      await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });

      const traversal1 = await ownerAgent.get("/api/backups/..%2F..%2Fetc%2Fpasswd");
      expect(traversal1.status).toBe(400);

      const traversal2 = await ownerAgent.get(encodeURI("/api/backups/../../etc/passwd"));
      expect([400, 404]).toContain(traversal2.status);

      const unknown = await ownerAgent.get("/api/backups/suprstar-20990101-000000.tar.gz");
      expect(unknown.status).toBe(404);

      const deleteUnknown = await ownerAgent.delete("/api/backups/suprstar-20990101-000000.tar.gz");
      expect(deleteUnknown.status).toBe(404);

      const deleteBad = await ownerAgent.delete("/api/backups/not-a-backup-name.zip");
      expect(deleteBad.status).toBe(400);
    });
  });
});
