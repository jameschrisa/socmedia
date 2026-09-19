import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type express from "express";
import { createApp } from "../app";
import { config } from "../config";
import { openDatabase } from "../db/database";
import type { Db } from "../db/database";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { ensureConnectionsForOrg } from "../routes/orgs";

export interface TestContext {
  db: Db;
  app: express.Express;
  dataDir: string;
  orgId: string;
}

/** Builds an isolated in-memory-db app with a temp DATA_DIR and one seeded organization. */
export function createTestContext(): TestContext {
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

  const app = createApp(db);
  return { db, app, dataDir, orgId: org.id };
}

export function cleanupTestContext(ctx: TestContext) {
  try {
    fs.rmSync(ctx.dataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/** A minimal 4x4 red PNG, useful for upload tests without needing sharp at test-authoring time. */
export function tinyPngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEUlEQVR4nGP8z8DwHwMDAwMACWkB8UdIYVoAAAAASUVORK5CYII=",
    "base64"
  );
}
