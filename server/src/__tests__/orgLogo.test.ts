import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#C9A24B"/></svg>');

describe("organization logos", () => {
  let ctx: TestContext;
  beforeEach(() => { ctx = createTestContext(); });
  afterEach(() => cleanupTestContext(ctx));

  it("uploads, replaces and removes a logo", async () => {
    const up = await request(ctx.app).post(`/api/orgs/${ctx.orgId}/logo`).attach("file", SVG, { filename: "mark.svg", contentType: "image/svg+xml" });
    expect(up.status).toBe(200);
    expect(up.body.logoUrl).toMatch(/^\/uploads\/logos\/.+\.svg$/);
    const file1 = path.join(ctx.dataDir, "uploads", "logos", path.basename(up.body.logoUrl));
    expect(fs.existsSync(file1)).toBe(true);

    const orgs = await request(ctx.app).get("/api/orgs");
    expect(orgs.body.find((o: any) => o.id === ctx.orgId).logoUrl).toBe(up.body.logoUrl);

    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const replace = await request(ctx.app).post(`/api/orgs/${ctx.orgId}/logo`).attach("file", png, { filename: "mark.png", contentType: "image/png" });
    expect(replace.body.logoUrl).toMatch(/\.png$/);
    expect(fs.existsSync(file1)).toBe(false);

    const removed = await request(ctx.app).delete(`/api/orgs/${ctx.orgId}/logo`);
    expect(removed.status).toBe(200);
    expect(removed.body.logoUrl).toBeNull();
  });

  it("rejects unsupported file types", async () => {
    const res = await request(ctx.app).post(`/api/orgs/${ctx.orgId}/logo`).attach("file", Buffer.from("hello"), { filename: "notes.txt", contentType: "text/plain" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("accepts relative logo paths on PATCH", async () => {
    const res = await request(ctx.app).patch(`/api/orgs/${ctx.orgId}`).send({ logoUrl: "/uploads/logos/x.svg" });
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe("/uploads/logos/x.svg");
  });
});
