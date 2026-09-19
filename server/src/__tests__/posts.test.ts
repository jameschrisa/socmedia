import sharp from "sharp";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

async function makePng(): Promise<Buffer> {
  return sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 10, g: 200, b: 100, alpha: 1 } } })
    .png()
    .toBuffer();
}

describe("posts", () => {
  let ctx: TestContext;
  let tiktokConnectionId: string;
  let mediaId: string;

  beforeEach(async () => {
    ctx = createTestContext();
    const conns = (await request(ctx.app).get("/api/connections").set("X-Org-Id", ctx.orgId)).body;
    tiktokConnectionId = conns.find((c: any) => c.platform === "tiktok").id;
    await request(ctx.app).post(`/api/connections/${tiktokConnectionId}/connect`).set("X-Org-Id", ctx.orgId);

    const png = await makePng();
    const media = await request(ctx.app)
      .post("/api/media")
      .set("X-Org-Id", ctx.orgId)
      .attach("file", png, { filename: "post.png", contentType: "image/png" });
    mediaId = media.body.id;
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  function validTarget() {
    return { platform: "tiktok", connectionId: tiktokConnectionId, format: "portrait_9_16", mediaIds: [mediaId] };
  }

  it("creates a draft post by default, and a scheduled post when scheduledAt is provided", async () => {
    const draft = await request(ctx.app).post("/api/posts").set("X-Org-Id", ctx.orgId).send({ title: "Draft post", caption: "hello" });
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe("draft");

    const future = new Date(Date.now() + 3_600_000).toISOString();
    const scheduled = await request(ctx.app)
      .post("/api/posts")
      .set("X-Org-Id", ctx.orgId)
      .send({ title: "Scheduled post", caption: "hello", scheduledAt: future, targets: [validTarget()] });
    expect(scheduled.status).toBe(201);
    expect(scheduled.body.status).toBe("scheduled");
  });

  it("gets, patches (drag-drop reschedule), and deletes a post", async () => {
    const created = await request(ctx.app).post("/api/posts").set("X-Org-Id", ctx.orgId).send({ title: "T", caption: "C" });
    const id = created.body.id;

    const got = await request(ctx.app).get(`/api/posts/${id}`).set("X-Org-Id", ctx.orgId);
    expect(got.status).toBe(200);
    expect(got.body.id).toBe(id);

    const newDate = new Date(Date.now() + 86_400_000).toISOString();
    const patched = await request(ctx.app).patch(`/api/posts/${id}`).set("X-Org-Id", ctx.orgId).send({ scheduledAt: newDate });
    expect(patched.status).toBe(200);
    expect(patched.body.scheduledAt).toBe(newDate);

    const deleted = await request(ctx.app).delete(`/api/posts/${id}`).set("X-Org-Id", ctx.orgId);
    expect(deleted.status).toBe(204);
    const afterDelete = await request(ctx.app).get(`/api/posts/${id}`).set("X-Org-Id", ctx.orgId);
    expect(afterDelete.status).toBe(404);
  });

  it("filters posts by scheduled date range", async () => {
    const inRange = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const outOfRange = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await request(ctx.app).post("/api/posts").set("X-Org-Id", ctx.orgId).send({ title: "In range", scheduledAt: inRange, targets: [validTarget()] });
    await request(ctx.app).post("/api/posts").set("X-Org-Id", ctx.orgId).send({ title: "Out of range", scheduledAt: outOfRange, targets: [validTarget()] });
    await request(ctx.app).post("/api/posts").set("X-Org-Id", ctx.orgId).send({ title: "Unscheduled draft" });

    const from = new Date(Date.now()).toISOString();
    const to = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const res = await request(ctx.app).get(`/api/posts?from=${from}&to=${to}`).set("X-Org-Id", ctx.orgId);
    expect(res.status).toBe(200);
    const titles = res.body.map((p: any) => p.title);
    expect(titles).toContain("In range");
    expect(titles).not.toContain("Out of range");
    expect(titles).not.toContain("Unscheduled draft");

    const withUnscheduled = await request(ctx.app).get(`/api/posts?from=${from}&to=${to}&includeUnscheduled=1`).set("X-Org-Id", ctx.orgId);
    expect(withUnscheduled.body.map((p: any) => p.title)).toContain("Unscheduled draft");
  });

  it("validate reports issues for an invalid target (wrong format for platform)", async () => {
    const created = await request(ctx.app)
      .post("/api/posts")
      .set("X-Org-Id", ctx.orgId)
      .send({ title: "Bad format", targets: [{ platform: "tiktok", connectionId: tiktokConnectionId, format: "landscape_16_9", mediaIds: [] }] });
    const res = await request(ctx.app).post(`/api/posts/${created.body.id}/validate`).set("X-Org-Id", ctx.orgId);
    expect(res.status).toBe(200);
    expect(res.body.issues.length).toBeGreaterThan(0);
    expect(res.body.issues.some((i: any) => i.level === "error")).toBe(true);
  });

  it("schedule rejects an invalid post with 400 and issues", async () => {
    const created = await request(ctx.app)
      .post("/api/posts")
      .set("X-Org-Id", ctx.orgId)
      .send({ title: "No media", targets: [{ platform: "tiktok", connectionId: tiktokConnectionId, format: "portrait_9_16", mediaIds: [] }] });
    const res = await request(ctx.app)
      .post(`/api/posts/${created.body.id}/schedule`)
      .set("X-Org-Id", ctx.orgId)
      .send({ scheduledAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(res.status).toBe(400);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("schedule succeeds for a valid post", async () => {
    const created = await request(ctx.app).post("/api/posts").set("X-Org-Id", ctx.orgId).send({ title: "Valid", targets: [validTarget()] });
    const res = await request(ctx.app)
      .post(`/api/posts/${created.body.id}/schedule`)
      .set("X-Org-Id", ctx.orgId)
      .send({ scheduledAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("scheduled");
  });

  it("publish creates a job per target and marks the post published with an external URL", async () => {
    const created = await request(ctx.app)
      .post("/api/posts")
      .set("X-Org-Id", ctx.orgId)
      .send({ title: "Publish me", caption: "Go live", targets: [validTarget()] });

    const res = await request(ctx.app).post(`/api/posts/${created.body.id}/publish`).set("X-Org-Id", ctx.orgId);
    expect(res.status).toBe(200);
    expect(res.body.post.status).toBe("published");
    expect(res.body.post.publishedAt).toBeTruthy();
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].status).toBe("succeeded");
    expect(res.body.jobs[0].externalUrl).toMatch(/tiktok\.com/);
  });

  it("duplicates a post as a fresh draft", async () => {
    const created = await request(ctx.app)
      .post("/api/posts")
      .set("X-Org-Id", ctx.orgId)
      .send({ title: "Original", scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), targets: [validTarget()] });
    const dup = await request(ctx.app).post(`/api/posts/${created.body.id}/duplicate`).set("X-Org-Id", ctx.orgId);
    expect(dup.status).toBe(201);
    expect(dup.body.id).not.toBe(created.body.id);
    expect(dup.body.status).toBe("draft");
    expect(dup.body.scheduledAt).toBeNull();
  });

  it("approve moves needs_approval to approved, or to scheduled when a date is set", async () => {
    const noDate = await request(ctx.app).post("/api/posts").set("X-Org-Id", ctx.orgId).send({ title: "Approve me", status: "needs_approval" });
    const approved = await request(ctx.app).post(`/api/posts/${noDate.body.id}/approve`).set("X-Org-Id", ctx.orgId);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");

    const future = new Date(Date.now() + 3_600_000).toISOString();
    const withDate = await request(ctx.app)
      .post("/api/posts")
      .set("X-Org-Id", ctx.orgId)
      .send({ title: "Approve+schedule", status: "needs_approval", scheduledAt: future, targets: [validTarget()] });
    const approvedScheduled = await request(ctx.app).post(`/api/posts/${withDate.body.id}/approve`).set("X-Org-Id", ctx.orgId);
    expect(approvedScheduled.status).toBe(200);
    expect(approvedScheduled.body.status).toBe("scheduled");
  });
});
