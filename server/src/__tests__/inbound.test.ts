import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InboundMessagesRepo } from "../db/repositories/inboundMessages";
import { processInbound } from "../services/inbound";
import { TEST_OWNER_PASSWORD, cleanupTestContext, createTestContext, tinyPngBuffer, type TestContext } from "./testApp";

function imageDataUrl(): string {
  return `data:image/png;base64,${tinyPngBuffer().toString("base64")}`;
}

describe("inbound messaging", () => {
  let ctx: TestContext;
  const orgHeader = () => ({ "X-Org-Id": ctx.orgId });

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  async function createBinding(senderId: string, overrides: Record<string, unknown> = {}) {
    const res = await request(ctx.app)
      .post("/api/inbound/bindings")
      .set(orgHeader())
      .send({ channel: "test", senderId, connectionIds: [], publishMode: "all", confirmBeforePosting: false, ...overrides });
    expect(res.status).toBe(201);
    return res.body as { id: string; verificationCode?: string; status: string };
  }

  it("replies with a refusal and records unknown_sender for a sender with no binding", async () => {
    const res = await request(ctx.app).post("/api/inbound/test").send({ senderId: "+15550000001", text: "hello there" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("unknown_sender");
    expect(res.body.reply).toBe("This number isn't linked to suprstar. Ask an owner for a link code.");
    expect(res.body.repliedBy).toBe("system");
  });

  it("verifies a pending binding when the sender replies with its 6-digit code", async () => {
    const binding = await createBinding("+15550000002");
    expect(binding.status).toBe("pending");
    expect(binding.verificationCode).toMatch(/^\d{6}$/);

    const res = await request(ctx.app).post("/api/inbound/test").send({ senderId: "+15550000002", text: binding.verificationCode });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("command");
    expect(res.body.reply).toBe("Linked to Test Org. Send a photo with a caption to post.");

    const list = await request(ctx.app).get("/api/inbound/bindings").set(orgHeader());
    expect(list.body.find((b: { id: string }) => b.id === binding.id).status).toBe("verified");
  });

  it("publishes a photo with a caption and replies with links", async () => {
    const pending = await createBinding("+15550000005");
    await request(ctx.app).post("/api/inbound/test").send({ senderId: "+15550000005", text: pending.verificationCode });

    const res = await request(ctx.app)
      .post("/api/inbound/test")
      .send({ senderId: "+15550000005", text: "Great sunset tonight", imageUrl: imageDataUrl() });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
    expect(res.body.repliedBy).toBe("system");
    expect(res.body.reply).toMatch(/^Posted to \d+ accounts:/);
    expect(res.body.links.length).toBeGreaterThan(0);
    expect(res.body.postId).toBeTruthy();
  });

  it("confirm-before-posting: stages the post, then publishes on a YES reply", async () => {
    const created = await request(ctx.app)
      .post("/api/inbound/bindings?verified=true")
      .set(orgHeader())
      .send({ channel: "test", senderId: "+15550000006", connectionIds: [], publishMode: "all", confirmBeforePosting: true });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("verified");

    const staged = await request(ctx.app)
      .post("/api/inbound/test")
      .send({ senderId: "+15550000006", text: "Look at this", imageUrl: imageDataUrl() });
    expect(staged.status).toBe(200);
    expect(staged.body.status).toBe("awaiting_confirmation");
    expect(staged.body.reply).toContain("Reply YES to post or NO to discard.");

    const confirmed = await request(ctx.app).post("/api/inbound/test").send({ senderId: "+15550000006", text: "yes" });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe("published");
    expect(confirmed.body.links.length).toBeGreaterThan(0);

    const original = await request(ctx.app).get(`/api/inbound/messages/${staged.body.id}`);
    expect(original.body.status).toBe("published");
  });

  it("saves a draft with a reply when a voice note arrives and transcription is not configured", async () => {
    const created = await request(ctx.app)
      .post("/api/inbound/bindings?verified=true")
      .set(orgHeader())
      .send({ channel: "test", senderId: "+15550000007", connectionIds: [], publishMode: "all", confirmBeforePosting: false });
    expect(created.status).toBe(201);

    const message = await processInbound(ctx.db, "test", {
      providerMessageId: "voice-note-1",
      senderId: "+15550000007",
      text: "",
      media: [{ url: imageDataUrl() }],
      audio: { url: `data:audio/ogg;base64,${Buffer.from("fake-audio-bytes").toString("base64")}`, mimeType: "audio/ogg" },
    });
    expect(message.status).toBe("draft");
    expect(message.reply).toBe("Saved as a draft: add a caption in suprstar.");
    expect(message.mediaIds.length).toBe(1);
    expect(message.postId).toBeTruthy();
  });

  it("runs a slash command through the agent and replies with its output", async () => {
    const created = await request(ctx.app)
      .post("/api/inbound/bindings?verified=true")
      .set(orgHeader())
      .send({ channel: "test", senderId: "+15550000008", connectionIds: [], publishMode: "all", confirmBeforePosting: false });
    expect(created.status).toBe(201);

    const res = await request(ctx.app).post("/api/inbound/test").send({ senderId: "+15550000008", text: "/status" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("command");
    expect(res.body.repliedBy).toBe("agent");
    expect(res.body.reply).toContain("Scheduler:");
  });

  it("is idempotent per (channel, providerMessageId)", async () => {
    const normalized = { providerMessageId: "dupe-1", senderId: "+15550000009", text: "hi", media: [] };
    const first = await processInbound(ctx.db, "test", normalized);
    const second = await processInbound(ctx.db, "test", normalized);
    expect(second.id).toBe(first.id);
    const repo = new InboundMessagesRepo(ctx.db);
    expect(repo.listAll({ channel: "test" }).filter((m) => m.providerMessageId === "dupe-1")).toHaveLength(1);
  });

  it("GET /api/inbound/status reports the test channel as listening with today's counts", async () => {
    await request(ctx.app).post("/api/inbound/test").send({ senderId: "+15550000010", text: "hi" });
    const res = await request(ctx.app).get("/api/inbound/status");
    expect(res.status).toBe(200);
    const testChannel = res.body.channels.find((c: { channel: string }) => c.channel === "test");
    expect(testChannel.state).toBe("listening");
    expect(testChannel.counts.today).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/inbound/stream emits a message event for a new inbound message", async () => {
    let captured = "";
    await new Promise<void>((resolve) => {
      const req = request(ctx.app).get("/api/inbound/stream");
      req.buffer(true).parse((res, callback) => {
        res.on("data", (chunk: Buffer) => {
          captured += chunk.toString("utf8");
          if (captured.includes("event: inbound")) res.destroy();
        });
        res.on("close", () => callback(null, null));
        res.on("end", () => callback(null, null));
      });
      req.end(() => resolve());
      setTimeout(() => {
        request(ctx.app).post("/api/inbound/test").send({ senderId: "+15550000011", text: "sse-marker" }).end(() => {});
      }, 50);
    });
    expect(captured).toContain("event: inbound");
    expect(captured).toContain("sse-marker");
  });
});

describe("inbound messaging role guards", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
    ctx.disableAuthBypass();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  it("403s a viewer on channel config and status", async () => {
    const owner = request.agent(ctx.app);
    await owner.post("/api/auth/login").send({ email: ctx.owner!.email, password: "password123" });
    await owner.post("/api/users").send({ email: "viewer-inbound@test.local", name: "Viewer", role: "viewer", orgIds: "*", password: "password123" });

    const viewer = request.agent(ctx.app);
    await viewer.post("/api/auth/login").send({ email: "viewer-inbound@test.local", password: "password123" });

    const status = await viewer.get("/api/inbound/status");
    expect(status.status).toBe(403);
    const channels = await viewer.get("/api/inbound/channels");
    expect(channels.status).toBe(403);
  });

  it("returns 400 when Telegram rejects the bot token, leaving the channel unregistered", async () => {
    const { setTelegramFetch, resetTelegramFetch } = await import("../inbound/telegram");
    setTelegramFetch((async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 })) as unknown as typeof fetch);
    const ownerAgent = request.agent(ctx.app);
    await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
    try {
      const res = await ownerAgent.put("/api/inbound/channels/telegram").send({ enabled: true, settings: { botToken: "bad-token" } });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Telegram rejected this token");
      expect(res.body.config.webhookRegistered).toBe(false);
    } finally {
      resetTelegramFetch();
    }
  });
});
