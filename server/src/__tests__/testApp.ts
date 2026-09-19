import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type express from "express";
import ffmpegPath from "ffmpeg-static";
import { nanoid } from "nanoid";
import type { User } from "@socmedia/shared";
import { createApp } from "../app";
import { config } from "../config";
import { openDatabase } from "../db/database";
import type { Db } from "../db/database";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { UsersRepo } from "../db/repositories/users";
import { ensureConnectionsForOrg } from "../routes/orgs";
import { hashPassword } from "../services/auth";

export const TEST_OWNER_PASSWORD = "password123";

export interface TestContext {
  db: Db;
  app: express.Express;
  dataDir: string;
  orgId: string;
  /** The seeded owner user (undefined when created with `{ seedOwner: false }`). */
  owner?: User;
  /** Disables the test-only "no cookie -> owner" auth bypass so real login/401/403 paths can be exercised. */
  disableAuthBypass: () => void;
}

export interface CreateTestContextOptions {
  /** Seeds an owner user ("owner@test.local"/"password123", orgIds "*") and enables the auth bypass. Default true. */
  seedOwner?: boolean;
}

/** Builds an isolated in-memory-db app with a temp DATA_DIR and one seeded organization. */
export function createTestContext(opts: CreateTestContextOptions = {}): TestContext {
  const seedOwner = opts.seedOwner !== false;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-test-"));
  config.dataDir = dataDir;

  const db = openDatabase(":memory:");
  const orgsRepo = new OrganizationsRepo(db);
  const org = orgsRepo.create({
    id: "org_test_1",
    name: "Test Org",
    slug: "test-org",
    brandColor: "#6C5CE7",
    timezone: "UTC",
    logoUrl: null,
    createdAt: new Date().toISOString(),
  });
  ensureConnectionsForOrg(db, org.id);

  let owner: User | undefined;
  if (seedOwner) {
    const usersRepo = new UsersRepo(db);
    owner = usersRepo.create({
      id: nanoid(),
      email: "owner@test.local",
      name: "Test Owner",
      role: "owner",
      orgIds: "*",
      passwordHash: hashPassword(TEST_OWNER_PASSWORD),
      active: true,
      mustChangePassword: false,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    });
    config.testAuthUserId = owner.id;
  } else {
    config.testAuthUserId = null;
  }

  const app = createApp(db);
  return {
    db,
    app,
    dataDir,
    orgId: org.id,
    owner,
    disableAuthBypass: () => {
      config.testAuthUserId = null;
    },
  };
}

export function cleanupTestContext(ctx: TestContext) {
  config.testAuthUserId = null;
  try {
    fs.rmSync(ctx.dataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

const execFileAsync = promisify(execFile);

/** Encodes a tiny, real test video (silent tone + generated pattern) with ffmpeg-static. */
export async function makeTestVideoBuffer(
  durationSeconds: number,
  opts: { size?: string; preset?: string } = {}
): Promise<Buffer> {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not found");
  const size = opts.size ?? "160x120";
  const preset = opts.preset ?? "veryfast";
  const tmpFile = path.join(os.tmpdir(), `pulse-test-video-${nanoid(8)}.mp4`);
  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc=size=${size}:rate=10`,
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440",
      "-t",
      String(durationSeconds),
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      "30",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      "-movflags",
      "+faststart",
      tmpFile,
    ],
    { timeout: 60000 }
  );
  const buffer = fs.readFileSync(tmpFile);
  fs.unlinkSync(tmpFile);
  return buffer;
}

/** A minimal 4x4 red PNG, useful for upload tests without needing sharp at test-authoring time. */
export function tinyPngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEUlEQVR4nGP8z8DwHwMDAwMACWkB8UdIYVoAAAAASUVORK5CYII=",
    "base64"
  );
}
