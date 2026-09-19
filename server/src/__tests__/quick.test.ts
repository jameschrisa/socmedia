import sharp from "sharp";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { UsersRepo } from "../db/repositories/users";
import { hashPassword } from "../services/auth";
import { resetQuickPostRateLimits } from "../services/quickPost";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

async function makePng(size = 40): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 10, g: 200, b: 100, alpha: 1 } } })
    .png()
    .toBuffer();
}

describe("quick post from a phone", () => {
  let ctx: TestContext;
  const h = () => ({ "X-Org-Id": ctx.orgId });

  beforeEach(() => {
    ctx = createTestContext();
    resetQuickPostRateLimits();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  async function createToken(overrides: Record<string, unknown> = {}): Promise<{ id: string; token: string }> {
    const res = await request(ctx.app).post("/api/quick/tokens").set(h()).send({ label: "Phone", ...overrides });
    expect(res.status).toBe(201);
    return res.body;
  }

  describe("token management", () => {
    it("creates, lists, updates and deletes a token (write role required)", async () => {
      const created = await createToken();
      expect(created.token).toBeTruthy();
      expect(created.token.length).toBeGreaterThanOrEqual(32);

      const list = await request(ctx.app).get("/api/quick/tokens").set(h());
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].token).toBeUndefined();

      const patched = await request(ctx.app).patch(`/api/quick/tokens/${created.id}`).set(h()).send({ label: "Updated", active: false });
      expect(patched.status).toBe(200);
      expect(patched.body.label).toBe("Updated");
      expect(patched.body.active).toBe(false);

      const del = await request(ctx.app).delete(`/api/quick/tokens/${created.id}`).set(h());
      expect(del.status).toBe(204);
      const listAfter = await request(ctx.app).get("/api/quick/tokens").set(h());
      expect(listAfter.body).toHaveLength(0);
    });

    it("viewers cannot manage quick post links", async () => {
      const usersRepo = new UsersRepo(ctx.db);
      usersRepo.create({
        id: nanoid(),
        email: "viewer@test.local",
        name: "Viewer",
        role: "viewer",
        orgIds: [ctx.orgId],
        passwordHash: hashPassword("password123"),
        active: true,
        mustChangePassword: false,
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
      });
      ctx.disableAuthBypass();
      const agent = request.agent(ctx.app);
      await agent.post("/api/auth/login").send({ email: "viewer@test.local", password: "password123" });
      const res = await agent.get("/api/quick/tokens").set(h());
      expect(res.status).toBe(403);
    });
  });

  describe("public info", () => {
    it("404s for unknown or inactive tokens, and never reveals the org id", async () => {
      const unknown = await request(ctx.app).get("/api/quick/not-a-real-token");
      expect(unknown.status).toBe(404);

      const created = await createToken();
      await request(ctx.app).patch(`/api/quick/tokens/${created.id}`).set(h()).send({ active: false });
      const inactive = await request(ctx.app).get(`/api/quick/${created.token}`);
      expect(inactive.status).toBe(404);
    });

    it("returns label, org branding and targets without a session", async () => {
      const created = await createToken();
      ctx.disableAuthBypass(); // proves this really doesn't need a session
      const res = await request(ctx.app).get(`/api/quick/${created.token}`);
      expect(res.status).toBe(200);
      expect(res.body.label).toBe("Phone");
      expect(res.body.orgName).toBeTruthy();
      expect(Array.isArray(res.body.targets)).toBe(true);
      expect(res.body.targets.length).toBeGreaterThan(0);
      expect(res.body).not.toHaveProperty("orgId");
    });
  });

  describe("submission", () => {
    it("with a caption: publishes immediately and returns links (sandbox)", async () => {
      const created = await createToken();
      const png = await makePng();
      const res = await request(ctx.app)
        .post(`/api/quick/${created.token}`)
        .field("caption", "Fresh from the phone!")
        .attach("image", png, { filename: "photo.jpg", contentType: "image/jpeg" });
      expect(res.status).toBe(201);
      expect(res.body.status).not.toBe("needs_caption");
      expect(res.body.caption).toBe("Fresh from the phone!");
      expect(res.body.captionSource).toBe("caption");
      expect(res.body.media.tags).toContain("quick");
      expect(res.body.links.length).toBeGreaterThan(0);
      for (const link of res.body.links) {
        expect(link.status).toBe("succeeded");
        expect(link.url).toBeTruthy();
      }
    });

    it("transcript path uses the mock caption (transcript as-is) when no AI provider is configured", async () => {
      const created = await createToken();
      const png = await makePng();
      const res = await request(ctx.app)
        .post(`/api/quick/${created.token}`)
        .field("transcript", "this is what I said out loud")
        .field("polish", "true")
        .attach("image", png, { filename: "photo.jpg", contentType: "image/jpeg" });
      expect(res.status).toBe(201);
      expect(res.body.captionSource).toBe("transcript");
      expect(res.body.caption).toBe("this is what I said out loud");
    });

    it("memo without a caption or transcript returns 202 needs_caption with empty links", async () => {
      const created = await createToken();
      const png = await makePng();
      const res = await request(ctx.app)
        .post(`/api/quick/${created.token}`)
        .attach("image", png, { filename: "photo.jpg", contentType: "image/jpeg" })
        .attach("memo", Buffer.from("fake-audio-bytes"), { filename: "memo.webm", contentType: "audio/webm" });
      expect(res.status).toBe(202);
      expect(res.body.status).toBe("needs_caption");
      expect(res.body.links).toEqual([]);
      expect(res.body.post.notes).toMatch(/Needs a caption/);
      expect(res.body.post.notes).toMatch(/Voice memo/);
    });

    it("rejects a missing image, a non-image file, and an oversized image", async () => {
      const created = await createToken();

      const missing = await request(ctx.app).post(`/api/quick/${created.token}`).field("caption", "hi");
      expect(missing.status).toBe(400);

      const wrongType = await request(ctx.app)
        .post(`/api/quick/${created.token}`)
        .field("caption", "hi")
        .attach("image", Buffer.from("not an image"), { filename: "file.txt", contentType: "text/plain" });
      expect(wrongType.status).toBe(400);

      const big = Buffer.alloc(16 * 1024 * 1024, 1);
      const oversized = await request(ctx.app)
        .post(`/api/quick/${created.token}`)
        .field("caption", "hi")
        .attach("image", big, { filename: "big.jpg", contentType: "image/jpeg" });
      expect(oversized.status).toBe(400);
    });

    it("inactive tokens 404 on submission too", async () => {
      const created = await createToken();
      await request(ctx.app).patch(`/api/quick/tokens/${created.id}`).set(h()).send({ active: false });
      const png = await makePng();
      const res = await request(ctx.app)
        .post(`/api/quick/${created.token}`)
        .field("caption", "hi")
        .attach("image", png, { filename: "p.jpg", contentType: "image/jpeg" });
      expect(res.status).toBe(404);
    });

    it("rate-limits submissions to 30 per hour per token", async () => {
      const created = await createToken();
      const png = await makePng();
      for (let i = 0; i < 30; i++) {
        const res = await request(ctx.app)
          .post(`/api/quick/${created.token}`)
          .field("caption", `post ${i}`)
          .attach("image", png, { filename: "p.jpg", contentType: "image/jpeg" });
        expect(res.status).toBe(201);
      }
      const res = await request(ctx.app)
        .post(`/api/quick/${created.token}`)
        .field("caption", "one too many")
        .attach("image", png, { filename: "p.jpg", contentType: "image/jpeg" });
      expect(res.status).toBe(429);
    }, 20000);
  });
});
