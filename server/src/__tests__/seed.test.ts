import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLATFORMS } from "@socmedia/shared";
import { config } from "../config";
import { openDatabase } from "../db/database";
import type { Db } from "../db/database";
import { ConnectionsRepo } from "../db/repositories/connections";
import { JobsRepo } from "../db/repositories/jobs";
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

  it("creates F3i and the Larkspur demo organization with connections and demo content", async () => {
    await seedIfEmpty(db);

    const orgsRepo = new OrganizationsRepo(db);
    const orgs = orgsRepo.list();
    expect(orgs).toHaveLength(3);
    const enel = orgs.find((o) => o.slug === "enel-health")!;
    expect(enel.name).toBe("Enel Health");
    expect(enel.logoUrl).toMatch(/^\/uploads\/logos\//);
    expect(orgs.map((o) => o.slug)).toEqual(expect.arrayContaining(["f3i", "larkspur-health"]));

    const org2 = orgs.find((o) => o.slug === "f3i")!;
    const org1 = orgs.find((o) => o.slug === "larkspur-health")!;
    const connectionsRepo = new ConnectionsRepo(db);
    expect(connectionsRepo.listByOrg(org1.id)).toHaveLength(PLATFORMS.length);
    expect(connectionsRepo.listByOrg(org2.id)).toHaveLength(PLATFORMS.length);

    const org1Connections = connectionsRepo.listByOrg(org1.id);
    expect(org1Connections.every((c) => c.status === "connected")).toBe(true);
    const org2Connections = connectionsRepo.listByOrg(org2.id);
    expect(org2Connections.every((c) => c.status === "disconnected")).toBe(true);

    // F3i's YouTube slot carries the real channel, and stays disconnected: naming an account is
    // not the same as having authorized one, and sandbox "connected" would imply OAuth happened.
    const f3iYouTube = org2Connections.find((c) => c.platform === "youtube")!;
    expect(f3iYouTube.displayName).toBe("Executive Upskill");
    expect(f3iYouTube.handle).toBe("@ExecutiveUpskill");
    expect(f3iYouTube.status).toBe("disconnected");
    // Every other F3i platform is still an unnamed placeholder.
    expect(org2Connections.filter((c) => c.displayName !== "").map((c) => c.platform)).toEqual(["youtube"]);

    const xConnection = org1Connections.find((c) => c.platform === "x")!;
    expect(xConnection).toBeTruthy();
    expect(xConnection.handle).toBe("@larkspurhealth");
    expect(xConnection.followers).toBeGreaterThan(0);

    const postsRepo = new PostsRepo(db);
    const posts = postsRepo.listByOrg(org1.id);
    expect(posts.length).toBeGreaterThanOrEqual(8);
    const statuses = new Set(posts.map((p) => p.status));
    expect(statuses.has("draft")).toBe(true);
    expect(statuses.has("scheduled")).toBe(true);
    expect(statuses.has("published")).toBe(true);
    expect(statuses.has("needs_approval")).toBe(true);

    const xPosts = posts.filter((p) => p.targets.some((t) => t.platform === "x"));
    expect(xPosts.length).toBeGreaterThanOrEqual(2);
    expect(xPosts.some((p) => p.status === "published")).toBe(true);
    expect(xPosts.some((p) => p.status === "scheduled")).toBe(true);

    const jobsRepo = new JobsRepo(db);
    const publishedXPost = xPosts.find((p) => p.status === "published")!;
    const xJob = jobsRepo.listByPost(publishedXPost.id).find((j) => j.platform === "x")!;
    expect(xJob.status).toBe("succeeded");
    expect(xJob.externalUrl).toMatch(/^https:\/\/x\.com\//);

    const mediaRepo = new MediaRepo(db);
    const media = mediaRepo.listByOrg(org1.id);
    expect(media).toHaveLength(4);
    for (const asset of media) {
      expect(fs.existsSync(path.join(dataDir, "uploads", org1.id, path.basename(asset.url)))).toBe(true);
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

describe("ensurePlatformCoverage", () => {
  it("adds accounts for platforms an existing organization is missing", async () => {
    const { ensurePlatformCoverage } = await import("../db/seed");
    const { ConnectionsRepo } = await import("../db/repositories/connections");
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-coverage-"));
    const db = openDatabase(path.join(dataDir, "test.db"));
    await seedIfEmpty(db);
    const orgs = new OrganizationsRepo(db).list();
    const connections = new ConnectionsRepo(db);
    const xConn = connections.getByOrgAndPlatform(orgs[0]!.id, "x")!;
    connections.delete(xConn.id);
    expect(connections.listByOrg(orgs[0]!.id)).toHaveLength(PLATFORMS.length - 1);

    expect(ensurePlatformCoverage(db)).toBe(1);
    expect(connections.listByOrg(orgs[0]!.id)).toHaveLength(PLATFORMS.length);
    expect(connections.getByOrgAndPlatform(orgs[0]!.id, "x")?.status).toBe("disconnected");
    // Idempotent on the next start.
    expect(ensurePlatformCoverage(db)).toBe(0);
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
