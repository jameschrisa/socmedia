import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

describe("analytics", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = createTestContext();
    const conns = (await request(ctx.app).get("/api/connections").set("X-Org-Id", ctx.orgId)).body;
    const tiktokId = conns.find((c: any) => c.platform === "tiktok").id;
    await request(ctx.app).post(`/api/connections/${tiktokId}/connect`).set("X-Org-Id", ctx.orgId);
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  it("sync pulls 30 days of deterministic metrics for each connected connection", async () => {
    const res = await request(ctx.app).post("/api/analytics/sync").set("X-Org-Id", ctx.orgId);
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(30);

    const snapshots = await request(ctx.app).get("/api/analytics/snapshots?platform=tiktok").set("X-Org-Id", ctx.orgId);
    expect(snapshots.status).toBe(200);
    expect(snapshots.body).toHaveLength(30);
    expect(snapshots.body[0]).toHaveProperty("engagementRate");
    expect(snapshots.body[0]).toHaveProperty("date");

    // re-sync should be idempotent (upsert), not duplicate rows
    await request(ctx.app).post("/api/analytics/sync").set("X-Org-Id", ctx.orgId);
    const snapshotsAgain = await request(ctx.app).get("/api/analytics/snapshots?platform=tiktok").set("X-Org-Id", ctx.orgId);
    expect(snapshotsAgain.body).toHaveLength(30);
  });

  it("summary aggregates totals and per-platform breakdowns", async () => {
    await request(ctx.app).post("/api/analytics/sync").set("X-Org-Id", ctx.orgId);
    const res = await request(ctx.app).get("/api/analytics/summary").set("X-Org-Id", ctx.orgId);
    expect(res.status).toBe(200);
    expect(res.body.range.from).toBeTruthy();
    expect(res.body.totals.impressions).toBeGreaterThan(0);
    expect(res.body.byPlatform.tiktok.snapshots).toBe(30);
    expect(res.body.byPlatform.youtube.snapshots).toBe(0);
    expect(Array.isArray(res.body.series)).toBe(true);
    expect(res.body.series.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.topPosts)).toBe(true);
  });

  it("best-times returns a heuristic fallback shape when there is no published history", async () => {
    const res = await request(ctx.app).post("/api/ai/best-times").set("X-Org-Id", ctx.orgId).send({ platform: "tiktok" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.slots)).toBe(true);
    expect(res.body.slots.length).toBeGreaterThan(0);
    for (const slot of res.body.slots) {
      expect(slot.weekday).toBeGreaterThanOrEqual(0);
      expect(slot.weekday).toBeLessThanOrEqual(6);
      expect(typeof slot.hour).toBe("number");
      expect(typeof slot.score).toBe("number");
    }
  });
});
