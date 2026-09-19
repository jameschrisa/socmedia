import sharp from "sharp";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

async function makePng(): Promise<Buffer> {
  return sharp({ create: { width: 90, height: 160, channels: 4, background: { r: 5, g: 5, b: 5, alpha: 1 } } })
    .png()
    .toBuffer();
}

describe("jobs", () => {
  let ctx: TestContext;
  let tiktokConnectionId: string;
  let mediaId: string;

  beforeEach(async () => {
    ctx = createTestContext();
    const conns = (await request(ctx.app).get("/api/connections").set("X-Org-Id", ctx.orgId)).body;
    tiktokConnectionId = conns.find((c: any) => c.platform === "tiktok").id;
    await request(ctx.app).post(`/api/connections/${tiktokConnectionId}/connect`).set("X-Org-Id", ctx.orgId);
    const media = await request(ctx.app)
      .post("/api/media")
      .set("X-Org-Id", ctx.orgId)
      .attach("file", await makePng(), { filename: "job.png", contentType: "image/png" });
    mediaId = media.body.id;
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  it("lists jobs for the org, newest first, with optional filters", async () => {
    const post = await request(ctx.app)
      .post("/api/posts")
      .set("X-Org-Id", ctx.orgId)
      .send({ title: "Job post", targets: [{ platform: "tiktok", connectionId: tiktokConnectionId, format: "portrait_9_16", mediaIds: [mediaId] }] });
    await request(ctx.app).post(`/api/posts/${post.body.id}/publish`).set("X-Org-Id", ctx.orgId);

    const all = await request(ctx.app).get("/api/jobs").set("X-Org-Id", ctx.orgId);
    expect(all.status).toBe(200);
    expect(all.body.length).toBeGreaterThanOrEqual(1);

    const byPost = await request(ctx.app).get(`/api/jobs?postId=${post.body.id}`).set("X-Org-Id", ctx.orgId);
    expect(byPost.body).toHaveLength(1);
    expect(byPost.body[0].postId).toBe(post.body.id);

    const byStatus = await request(ctx.app).get("/api/jobs?status=succeeded").set("X-Org-Id", ctx.orgId);
    expect(byStatus.body.every((j: any) => j.status === "succeeded")).toBe(true);

    const limited = await request(ctx.app).get("/api/jobs?limit=1").set("X-Org-Id", ctx.orgId);
    expect(limited.body).toHaveLength(1);
  });

  it("retries a job, re-running it and incrementing attempts", async () => {
    const post = await request(ctx.app)
      .post("/api/posts")
      .set("X-Org-Id", ctx.orgId)
      .send({ title: "Retry post", targets: [{ platform: "tiktok", connectionId: tiktokConnectionId, format: "portrait_9_16", mediaIds: [mediaId] }] });
    const published = await request(ctx.app).post(`/api/posts/${post.body.id}/publish`).set("X-Org-Id", ctx.orgId);
    const jobId = published.body.jobs[0].id;
    expect(published.body.jobs[0].attempts).toBe(1);

    const retried = await request(ctx.app).post(`/api/jobs/${jobId}/retry`).set("X-Org-Id", ctx.orgId);
    expect(retried.status).toBe(200);
    expect(retried.body.attempts).toBe(2);
    expect(retried.body.status).toBe("succeeded");
    expect(retried.body.log.length).toBeGreaterThan(published.body.jobs[0].log.length);
  });

  it("404s retrying an unknown job", async () => {
    const res = await request(ctx.app).post("/api/jobs/does-not-exist/retry").set("X-Org-Id", ctx.orgId);
    expect(res.status).toBe(404);
  });
});
