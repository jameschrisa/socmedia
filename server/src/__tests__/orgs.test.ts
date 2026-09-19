import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLATFORMS } from "@socmedia/shared";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

describe("organizations", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  it("lists the seeded organization", async () => {
    const res = await request(ctx.app).get("/api/orgs");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((o: { id: string }) => o.id === ctx.orgId)).toBe(true);
  });

  it("creates a new org and seeds one disconnected connection per platform", async () => {
    const res = await request(ctx.app).post("/api/orgs").send({ name: "Acme Advisors", brandColor: "#123456", timezone: "UTC" });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("acme-advisors");
    expect(res.body.brandColor).toBe("#123456");

    const conns = await request(ctx.app).get("/api/connections").set("X-Org-Id", res.body.id);
    expect(conns.status).toBe(200);
    expect(conns.body).toHaveLength(PLATFORMS.length);
    for (const platform of PLATFORMS) {
      const match = conns.body.find((c: { platform: string }) => c.platform === platform);
      expect(match).toBeTruthy();
      expect(match.status).toBe("disconnected");
      expect(match.mode).toBe("sandbox");
      expect(match.enabled).toBe(true);
    }
  });

  it("404s for an unknown org id", async () => {
    const res = await request(ctx.app).get("/api/orgs/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it("updates an org via PATCH", async () => {
    const res = await request(ctx.app).patch(`/api/orgs/${ctx.orgId}`).send({ name: "Renamed Org" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed Org");
  });

  it("deletes an org when more than one exists, and refuses to delete the last one", async () => {
    const created = await request(ctx.app).post("/api/orgs").send({ name: "Second Org" });
    expect(created.status).toBe(201);

    const del1 = await request(ctx.app).delete(`/api/orgs/${created.body.id}`);
    expect(del1.status).toBe(204);

    const del2 = await request(ctx.app).delete(`/api/orgs/${ctx.orgId}`);
    expect(del2.status).toBe(409);
    expect(del2.body.error).toBeTruthy();
  });
});
