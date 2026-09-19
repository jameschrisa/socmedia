import fs from "node:fs";
import sharp from "sharp";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveMediaPath } from "../services/media";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 100, g: 120, b: 200, alpha: 1 } } })
    .png()
    .toBuffer();
}

describe("media", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  it("uploads a real PNG, detects dimensions, and generates a thumbnail", async () => {
    const png = await makePng(200, 150);
    const res = await request(ctx.app)
      .post("/api/media")
      .set("X-Org-Id", ctx.orgId)
      .field("tags", "brand,demo")
      .attach("file", png, { filename: "test.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("image");
    expect(res.body.width).toBe(200);
    expect(res.body.height).toBe(150);
    expect(res.body.tags).toEqual(["brand", "demo"]);
    expect(res.body.thumbnailUrl).toBeTruthy();

    expect(fs.existsSync(resolveMediaPath(res.body.url))).toBe(true);
    expect(fs.existsSync(resolveMediaPath(res.body.thumbnailUrl))).toBe(true);
  });

  it("rejects an upload with no file field", async () => {
    const res = await request(ctx.app).post("/api/media").set("X-Org-Id", ctx.orgId);
    expect(res.status).toBe(400);
  });

  it("saves an exported data URL as a media asset", async () => {
    const png = await makePng(64, 64);
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    const res = await request(ctx.app)
      .post("/api/media/export")
      .set("X-Org-Id", ctx.orgId)
      .send({ dataUrl, filename: "export.png", format: "square", tags: ["exported"] });

    expect(res.status).toBe(201);
    expect(res.body.format).toBe("square");
    expect(res.body.tags).toEqual(["exported"]);
    expect(fs.existsSync(resolveMediaPath(res.body.url))).toBe(true);
  });

  it("updates tags via PATCH", async () => {
    const png = await makePng(50, 50);
    const created = await request(ctx.app)
      .post("/api/media")
      .set("X-Org-Id", ctx.orgId)
      .attach("file", png, { filename: "tags.png", contentType: "image/png" });

    const patched = await request(ctx.app)
      .patch(`/api/media/${created.body.id}`)
      .set("X-Org-Id", ctx.orgId)
      .send({ tags: ["a", "b", "c"] });
    expect(patched.status).toBe(200);
    expect(patched.body.tags).toEqual(["a", "b", "c"]);
  });

  it("deletes a media asset and its files from disk", async () => {
    const png = await makePng(80, 80);
    const created = await request(ctx.app)
      .post("/api/media")
      .set("X-Org-Id", ctx.orgId)
      .attach("file", png, { filename: "delete-me.png", contentType: "image/png" });

    const url = created.body.url;
    const del = await request(ctx.app).delete(`/api/media/${created.body.id}`).set("X-Org-Id", ctx.orgId);
    expect(del.status).toBe(204);
    expect(fs.existsSync(resolveMediaPath(url))).toBe(false);

    const getAfter = await request(ctx.app).get("/api/media").set("X-Org-Id", ctx.orgId);
    expect(getAfter.body.find((m: { id: string }) => m.id === created.body.id)).toBeUndefined();
  });
});
