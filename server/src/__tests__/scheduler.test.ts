import sharp from "sharp";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostsRepo } from "../db/repositories/posts";
import { runSchedulerTick } from "../services/scheduler";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

async function makePng(): Promise<Buffer> {
  return sharp({ create: { width: 100, height: 178, channels: 4, background: { r: 50, g: 50, b: 220, alpha: 1 } } })
    .png()
    .toBuffer();
}

describe("scheduler", () => {
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
      .attach("file", await makePng(), { filename: "sched.png", contentType: "image/png" });
    mediaId = media.body.id;
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  function target() {
    return { platform: "tiktok", connectionId: tiktokConnectionId, format: "portrait_9_16", mediaIds: [mediaId] };
  }

  it("publishes only posts whose scheduledAt has passed", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();

    const due = await request(ctx.app).post("/api/posts").set("X-Org-Id", ctx.orgId).send({ title: "Due", scheduledAt: past, targets: [target()] });
    const notDue = await request(ctx.app).post("/api/posts").set("X-Org-Id", ctx.orgId).send({ title: "Not due", scheduledAt: future, targets: [target()] });
    expect(due.body.status).toBe("scheduled");
    expect(notDue.body.status).toBe("scheduled");

    const count = await runSchedulerTick(ctx.db, new Date());
    expect(count).toBe(1);

    const postsRepo = new PostsRepo(ctx.db);
    expect(postsRepo.get(due.body.id)!.status).toBe("published");
    expect(postsRepo.get(notDue.body.id)!.status).toBe("scheduled");
  });

  it("is idempotent: a second tick immediately after finds nothing new to publish", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    await request(ctx.app).post("/api/posts").set("X-Org-Id", ctx.orgId).send({ title: "Due once", scheduledAt: past, targets: [target()] });

    const first = await runSchedulerTick(ctx.db, new Date());
    const second = await runSchedulerTick(ctx.db, new Date());
    expect(first).toBe(1);
    expect(second).toBe(0);
  });
});
