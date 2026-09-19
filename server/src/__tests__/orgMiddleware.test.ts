import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

describe("org middleware", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  it("rejects org-scoped requests with no org header/query with 400", async () => {
    const res = await request(ctx.app).get("/api/posts");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/org/i);
  });

  it("rejects an unknown org id with 400", async () => {
    const res = await request(ctx.app).get("/api/posts").set("X-Org-Id", "not-a-real-org");
    expect(res.status).toBe(400);
  });

  it("accepts the org id via query param as an alternative to the header", async () => {
    const res = await request(ctx.app).get(`/api/posts?orgId=${ctx.orgId}`);
    expect(res.status).toBe(200);
  });

  it("accepts the org id via the X-Org-Id header", async () => {
    const res = await request(ctx.app).get("/api/posts").set("X-Org-Id", ctx.orgId);
    expect(res.status).toBe(200);
  });
});
