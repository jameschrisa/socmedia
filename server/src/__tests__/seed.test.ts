import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLATFORMS } from "@socmedia/shared";
import { config } from "../config";
import { openDatabase } from "../db/database";
import type { Db } from "../db/database";
import { ConnectionsRepo } from "../db/repositories/connections";
import { MediaRepo } from "../db/repositories/media";
import { MetricsRepo } from "../db/repositories/metrics";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { PostsRepo } from "../db/repositories/posts";
import { seedIfEmpty } from "../db/seed";

describe("seedIfEmpty", () => {
  let db: Db;
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-seed-test-"));
    config.dataDir = dataDir;
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates three organizations, connections for each platform, and demo content for the demo brands", async () => {
    await seedIfEmpty(db);

    const orgsRepo = new OrganizationsRepo(db);
    const orgs = orgsRepo.list();
    expect(orgs).toHaveLength(3);
    expect(orgs.map((o) => o.slug)).toEqual(expect.arrayContaining(["holistiplan", "f3i", "larkspur-coffee"]));

    const [org1, org2] = orgs;
    const connectionsRepo = new ConnectionsRepo(db);
    expect(connectionsRepo.listByOrg(org1.id)).toHaveLength(PLATFORMS.length);
    expect(connectionsRepo.listByOrg(org2.id)).toHaveLength(PLATFORMS.length);

    const org1Connections = connectionsRepo.listByOrg(org1.id);
    expect(org1Connections.every((c) => c.status === "connected")).toBe(true);
    const org2Connections = connectionsRepo.listByOrg(org2.id);
    expect(org2Connections.every((c) => c.status === "disconnected")).toBe(true);

    const postsRepo = new PostsRepo(db);
    const posts = postsRepo.listByOrg(org1.id);
    expect(posts.length).toBeGreaterThanOrEqual(8);
    const statuses = new Set(posts.map((p) => p.status));
    expect(statuses.has("draft")).toBe(true);
    expect(statuses.has("scheduled")).toBe(true);
    expect(statuses.has("published")).toBe(true);
    expect(statuses.has("needs_approval")).toBe(true);

    const mediaRepo = new MediaRepo(db);
    const media = mediaRepo.listByOrg(org1.id);
    expect(media).toHaveLength(4);
    for (const asset of media) {
      expect(fs.existsSync(path.join(dataDir, "uploads", org1.id, asset.filename))).toBe(true);
    }

    const metricsRepo = new MetricsRepo(db);
    const snapshots = metricsRepo.listByOrg(org1.id);
    expect(snapshots.length).toBe(30 * org1Connections.length);
  });

  it("is idempotent: running seedIfEmpty again does not duplicate data", async () => {
    await seedIfEmpty(db);
    const orgsRepo = new OrganizationsRepo(db);
    const countBefore = orgsRepo.count();

    await seedIfEmpty(db);
    expect(orgsRepo.count()).toBe(countBefore);
  });
});
