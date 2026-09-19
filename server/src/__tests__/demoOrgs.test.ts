import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";
import { DEMO_PROFILES } from "../db/seed";

describe("demo organizations", () => {
  let ctx: TestContext;
  beforeEach(() => { ctx = createTestContext(); });
  afterEach(() => cleanupTestContext(ctx));

  it("lists the available profiles", async () => {
    const res = await request(ctx.app).get("/api/orgs/demo/profiles");
    expect(res.status).toBe(200);
    expect(res.body.map((p: any) => p.key).sort()).toEqual(Object.keys(DEMO_PROFILES).sort());
    expect(res.body.find((p: any) => p.key === "larkspur").posts).toBeGreaterThanOrEqual(8);
  });

  it("creates a filled organization from a profile", async () => {
    const res = await request(ctx.app).post("/api/orgs/demo").send({ profile: "larkspur" });
    expect(res.status).toBe(201);
    const org = res.body;
    expect(org.name).toBe("Larkspur Health");
    const h = { "X-Org-Id": org.id };
    const conns = (await request(ctx.app).get("/api/connections").set(h)).body;
    expect(conns).toHaveLength(4);
    expect(conns.every((c: any) => c.status === "connected" && c.handle === "@larkspurhealth")).toBe(true);
    const posts = (await request(ctx.app).get("/api/posts?includeUnscheduled=1").set(h)).body;
    expect(posts.length).toBe(DEMO_PROFILES.larkspur!.posts.length);
    expect(new Set(posts.map((p: any) => p.status))).toEqual(expect.any(Set));
    expect(posts.some((p: any) => p.status === "draft")).toBe(true);
    expect(posts.some((p: any) => p.status === "needs_approval")).toBe(true);
    const media = (await request(ctx.app).get("/api/media").set(h)).body;
    expect(media.length).toBeGreaterThanOrEqual(4);
    const jobs = (await request(ctx.app).get("/api/jobs").set(h)).body;
    expect(jobs.some((j: any) => j.status === "failed")).toBe(true);
    const summary = (await request(ctx.app).get("/api/analytics/summary").set(h)).body;
    expect(summary.totals.impressions).toBeGreaterThan(0);

    // second creation gets a unique slug
    const again = await request(ctx.app).post("/api/orgs/demo").send({ profile: "larkspur" });
    expect(again.status).toBe(201);
    expect(again.body.slug).not.toBe(org.slug);
  });

  it("fills an existing organization and rejects unknown profiles", async () => {
    const created = (await request(ctx.app).post("/api/orgs").send({ name: "Blank Co", brandColor: "#123456", timezone: "UTC" })).body;
    const bad = await request(ctx.app).post(`/api/orgs/${created.id}/demo`).send({ profile: "nope" });
    expect(bad.status).toBe(400);
    const ok = await request(ctx.app).post(`/api/orgs/${created.id}/demo`).send({ profile: "larkspur" });
    expect(ok.status).toBe(200);
    const posts = (await request(ctx.app).get("/api/posts?includeUnscheduled=1").set("X-Org-Id", created.id)).body;
    expect(posts.length).toBe(DEMO_PROFILES.larkspur!.posts.length);
  });
});
