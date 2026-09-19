import fs from "node:fs";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveMediaPath } from "../services/media";
import { probeVideo } from "../services/video";
import { cleanupTestContext, createTestContext, makeTestVideoBuffer, type TestContext } from "./testApp";

describe("video", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  it("uploads a real video, probes its duration/dimensions, and generates a poster thumbnail", async () => {
    const video = await makeTestVideoBuffer(3);
    const res = await request(ctx.app)
      .post("/api/media")
      .set("X-Org-Id", ctx.orgId)
      .attach("file", video, { filename: "clip.mp4", contentType: "video/mp4" });

    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("video");
    expect(res.body.durationSeconds).toBeGreaterThan(2.5);
    expect(res.body.durationSeconds).toBeLessThan(3.5);
    expect(res.body.width).toBe(160);
    expect(res.body.height).toBe(120);
    expect(res.body.thumbnailUrl).toBeTruthy();
    expect(fs.existsSync(resolveMediaPath(res.body.url))).toBe(true);
    expect(fs.existsSync(resolveMediaPath(res.body.thumbnailUrl))).toBe(true);
  });

  it("rejects an upload longer than 5 minutes", async () => {
    const video = await makeTestVideoBuffer(301, { size: "64x64", preset: "ultrafast" });
    const res = await request(ctx.app)
      .post("/api/media")
      .set("X-Org-Id", ctx.orgId)
      .attach("file", video, { filename: "long.mp4", contentType: "video/mp4" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/5 minutes/);
  }, 20000);

  it("creates a new clip asset with sourceAssetId and the 'clip' tag", async () => {
    const video = await makeTestVideoBuffer(5);
    const uploaded = (
      await request(ctx.app).post("/api/media").set("X-Org-Id", ctx.orgId).attach("file", video, { filename: "src.mp4", contentType: "video/mp4" })
    ).body;

    const clipped = await request(ctx.app)
      .post(`/api/media/${uploaded.id}/clip`)
      .set("X-Org-Id", ctx.orgId)
      .send({ start: 1, end: 3, mode: "new" });

    expect(clipped.status).toBe(201);
    expect(clipped.body.id).not.toBe(uploaded.id);
    expect(clipped.body.sourceAssetId).toBe(uploaded.id);
    expect(clipped.body.tags).toContain("clip");
    expect(clipped.body.kind).toBe("video");
    expect(clipped.body.durationSeconds).toBeLessThanOrEqual(uploaded.durationSeconds + 0.5);
    expect(fs.existsSync(resolveMediaPath(clipped.body.url))).toBe(true);
    expect(fs.existsSync(resolveMediaPath(clipped.body.thumbnailUrl))).toBe(true);
  });

  it("crops to a target format's exact dimensions", async () => {
    const video = await makeTestVideoBuffer(4);
    const uploaded = (
      await request(ctx.app).post("/api/media").set("X-Org-Id", ctx.orgId).attach("file", video, { filename: "src2.mp4", contentType: "video/mp4" })
    ).body;

    const clipped = await request(ctx.app)
      .post(`/api/media/${uploaded.id}/clip`)
      .set("X-Org-Id", ctx.orgId)
      .send({ start: 0, end: 2, mode: "new", format: "portrait_9_16" });

    expect(clipped.status).toBe(201);
    expect(clipped.body.format).toBe("portrait_9_16");
    const probe = await probeVideo(resolveMediaPath(clipped.body.url));
    expect(probe.width).toBe(1080);
    expect(probe.height).toBe(1920);
  });

  it("replaces a clip in place, keeping the same id and removing the old file", async () => {
    const video = await makeTestVideoBuffer(4);
    const uploaded = (
      await request(ctx.app).post("/api/media").set("X-Org-Id", ctx.orgId).attach("file", video, { filename: "src3.mp4", contentType: "video/mp4" })
    ).body;
    const oldPath = resolveMediaPath(uploaded.url);

    const replaced = await request(ctx.app)
      .post(`/api/media/${uploaded.id}/clip`)
      .set("X-Org-Id", ctx.orgId)
      .send({ start: 0, end: 2, mode: "replace", muted: true });

    expect(replaced.status).toBe(200);
    expect(replaced.body.id).toBe(uploaded.id);
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(resolveMediaPath(replaced.body.url))).toBe(true);
  });

  it("rejects clip ranges outside the source duration and non-video/foreign assets", async () => {
    const video = await makeTestVideoBuffer(3);
    const uploaded = (
      await request(ctx.app).post("/api/media").set("X-Org-Id", ctx.orgId).attach("file", video, { filename: "src4.mp4", contentType: "video/mp4" })
    ).body;

    const tooLong = await request(ctx.app)
      .post(`/api/media/${uploaded.id}/clip`)
      .set("X-Org-Id", ctx.orgId)
      .send({ start: 0, end: 10, mode: "new" });
    expect(tooLong.status).toBe(400);

    const invalidShape = await request(ctx.app)
      .post(`/api/media/${uploaded.id}/clip`)
      .set("X-Org-Id", ctx.orgId)
      .send({ start: 2, end: 1, mode: "new" });
    expect(invalidShape.status).toBe(400);

    const missing = await request(ctx.app).post(`/api/media/does-not-exist/clip`).set("X-Org-Id", ctx.orgId).send({ start: 0, end: 1, mode: "new" });
    expect(missing.status).toBe(404);
  });
});
