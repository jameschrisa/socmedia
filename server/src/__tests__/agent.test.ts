import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { ConnectionsRepo } from "../db/repositories/connections";
import { UsersRepo } from "../db/repositories/users";
import { hashPassword } from "../services/auth";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

/** Marks the org's youtube connection as failed with a realistic OAuth error, so platform_docs/diagnose_connection have something to find. */
function failYoutubeConnectionWithInvalidGrant(ctx: TestContext): string {
  const repo = new ConnectionsRepo(ctx.db);
  const conn = repo.listByOrgAndPlatform(ctx.orgId, "youtube")[0];
  const now = new Date().toISOString();
  repo.save({
    ...conn,
    status: "error",
    lastTest: { ok: false, checkedAt: now, latencyMs: 42, message: "invalid_grant", details: [] },
  });
  return conn.id;
}

const { mockCreate, AnthropicMock } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  class AuthenticationError extends Error {}
  class RateLimitError extends Error {}
  class NotFoundError extends Error {}
  class APIError extends Error {}
  function AnthropicMock(this: { messages: { create: typeof mockCreate } }) {
    this.messages = { create: mockCreate };
  }
  (AnthropicMock as unknown as Record<string, unknown>).AuthenticationError = AuthenticationError;
  (AnthropicMock as unknown as Record<string, unknown>).RateLimitError = RateLimitError;
  (AnthropicMock as unknown as Record<string, unknown>).NotFoundError = NotFoundError;
  (AnthropicMock as unknown as Record<string, unknown>).APIError = APIError;
  return { mockCreate, AnthropicMock };
});

vi.mock("@anthropic-ai/sdk", () => ({ default: AnthropicMock }));

describe("agent console", () => {
  let ctx: TestContext;
  const h = () => ({ "X-Org-Id": ctx.orgId });

  beforeEach(() => {
    ctx = createTestContext();
    mockCreate.mockReset();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  describe("slash commands", () => {
    it("/help lists the available commands", async () => {
      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "/help" });
      expect(res.status).toBe(200);
      expect(res.body.reply).toContain("/status");
      expect(res.body.reply).toContain("/publish");
      expect(res.body.actions).toEqual([]);
      expect(res.body.model).toBe("slash-command");
      expect(res.body.mock).toBe(false);
    });

    it("/whoami reports the caller's identity", async () => {
      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "/whoami" });
      expect(res.status).toBe(200);
      expect(res.body.reply).toContain(ctx.owner!.email);
      expect(res.body.reply).toContain("owner");
    });

    it("/status reports scheduler, post counts and accounts", async () => {
      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "/status" });
      expect(res.status).toBe(200);
      expect(res.body.reply).toMatch(/Scheduler/);
      expect(res.body.reply).toMatch(/Posts \(/);
      expect(res.body.reply).toMatch(/Accounts:/);
    });

    it("/posts lists posts created in the org", async () => {
      await request(ctx.app).post("/api/posts").set(h()).send({ title: "Hello world", caption: "hi" });
      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "/posts" });
      expect(res.status).toBe(200);
      expect(res.body.reply).toContain("Hello world");
      expect(res.body.actions[0]).toMatchObject({ tool: "list_posts", ok: true });
    });

    it("/publish requires an id and reports the resulting status", async () => {
      const usage = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "/publish" });
      expect(usage.body.reply).toMatch(/Usage/);

      const created = await request(ctx.app).post("/api/posts").set(h()).send({ title: "T", caption: "C" });
      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: `/publish ${created.body.id}` });
      expect(res.status).toBe(200);
      expect(res.body.actions[0]).toMatchObject({ tool: "publish_post", ok: true });
    });

    it("unknown slash commands get a helpful error", async () => {
      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "/bogus" });
      expect(res.status).toBe(200);
      expect(res.body.reply).toMatch(/Unknown command/);
    });
  });

  describe("role refusal", () => {
    async function loginAs(role: "viewer" | "editor"): Promise<request.Agent> {
      const usersRepo = new UsersRepo(ctx.db);
      const email = `${role}@test.local`;
      usersRepo.create({
        id: nanoid(),
        email,
        name: role,
        role,
        orgIds: [ctx.orgId],
        passwordHash: hashPassword("password123"),
        active: true,
        mustChangePassword: false,
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
      });
      ctx.disableAuthBypass();
      const agent = request.agent(ctx.app);
      await agent.post("/api/auth/login").send({ email, password: "password123" });
      return agent;
    }

    it("viewers are refused when they try to publish via a slash command", async () => {
      const created = await request(ctx.app).post("/api/posts").set(h()).send({ title: "T", caption: "C" });
      const agent = await loginAs("viewer");
      const res = await agent.post("/api/agent/commands").set(h()).send({ input: `/publish ${created.body.id}` });
      expect(res.status).toBe(200);
      expect(res.body.actions[0]).toMatchObject({ tool: "publish_post", ok: false });
      expect(res.body.reply).toMatch(/Viewers cannot/);
      // read-only slash commands still work for viewers
      const status = await agent.post("/api/agent/commands").set(h()).send({ input: "/status" });
      expect(status.status).toBe(200);
    });
  });

  describe("mock agent (no AI provider configured)", () => {
    it("answers list-posts style free text deterministically", async () => {
      await request(ctx.app).post("/api/posts").set(h()).send({ title: "Mock post", caption: "hi" });
      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "list posts" });
      expect(res.status).toBe(200);
      expect(res.body.mock).toBe(true);
      expect(res.body.reply).toContain("Mock post");
      expect(res.body.actions[0]).toMatchObject({ tool: "list_posts", ok: true });
    });

    it("tells the user it needs an AI provider for unrecognized free text", async () => {
      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "please write me a poem" });
      expect(res.status).toBe(200);
      expect(res.body.mock).toBe(true);
      expect(res.body.reply).toMatch(/AI provider/);
    });
  });

  describe("Anthropic tool-use loop", () => {
    it("calls a tool then finishes on end_turn", async () => {
      const settings = await request(ctx.app)
        .put("/api/settings/ai")
        .send({ provider: "anthropic", anthropic: { apiKey: "sk-test-key", model: "claude-test-model" } });
      expect(settings.status).toBe(200);

      await request(ctx.app).post("/api/posts").set(h()).send({ title: "Agent findable post", caption: "hi" });

      mockCreate
        .mockResolvedValueOnce({
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "call_1", name: "list_posts", input: {} }],
        })
        .mockResolvedValueOnce({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "You have one post: Agent findable post." }],
        });

      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "what posts do I have?" });
      expect(res.status).toBe(200);
      expect(res.body.mock).toBe(false);
      expect(res.body.model).toBe("claude-test-model");
      expect(res.body.reply).toBe("You have one post: Agent findable post.");
      expect(res.body.actions).toHaveLength(1);
      expect(res.body.actions[0]).toMatchObject({ tool: "list_posts", ok: true });
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe("platform docs slash commands", () => {
    it("/docs <platform> <query> lists top doc hits with file and heading", async () => {
      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "/docs youtube invalid_grant" });
      expect(res.status).toBe(200);
      expect(res.body.actions[0]).toMatchObject({ tool: "platform_docs", ok: true });
      expect(res.body.reply).not.toMatch(/No doc hits/);
      expect(res.body.reply).toMatch(/\[youtube\]/);
      expect(res.body.reply).toMatch(/youtube[/\\].*\.md/);
    });

    it("/docs <query> (no platform token) still searches", async () => {
      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "/docs invalid_grant" });
      expect(res.status).toBe(200);
      expect(res.body.reply).not.toMatch(/No doc hits/);
    });

    it("/docs with no query shows usage", async () => {
      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "/docs" });
      expect(res.body.reply).toMatch(/Usage/);
    });

    it("/diagnose <platform> bundles status, last test and doc hits", async () => {
      failYoutubeConnectionWithInvalidGrant(ctx);
      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "/diagnose youtube" });
      expect(res.status).toBe(200);
      expect(res.body.actions.map((a: { tool: string }) => a.tool)).toContain("diagnose_connection");
      expect(res.body.reply).toMatch(/youtube/i);
      expect(res.body.reply).toMatch(/Last test: FAILED — invalid_grant/);
      expect(res.body.reply).toMatch(/Top doc matches:/);
    });

    it("/diagnose <connectionId> works directly with an id", async () => {
      const connectionId = failYoutubeConnectionWithInvalidGrant(ctx);
      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: `/diagnose ${connectionId}` });
      expect(res.status).toBe(200);
      expect(res.body.reply).toMatch(/Last test: FAILED — invalid_grant/);
    });

    it("/diagnose with an unknown platform/id reports usage or not-found", async () => {
      const usage = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "/diagnose" });
      expect(usage.body.reply).toMatch(/Usage/);

      const notFound = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "/diagnose nope-not-real" });
      expect(notFound.body.reply).toMatch(/not found/i);
    });
  });

  describe("mock agent routes diagnostic questions to diagnose_connection", () => {
    it('routes "why did youtube fail" to diagnose_connection and quotes a doc hit', async () => {
      failYoutubeConnectionWithInvalidGrant(ctx);
      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "why did youtube fail?" });
      expect(res.status).toBe(200);
      expect(res.body.mock).toBe(true);
      expect(res.body.actions.map((a: { tool: string }) => a.tool)).toEqual(expect.arrayContaining(["list_accounts", "diagnose_connection"]));
      expect(res.body.reply).toMatch(/youtube/i);
      expect(res.body.reply).toMatch(/Source:/);
    });

    it('"what failed" with no platform mentioned falls back to the generic failed-jobs summary', async () => {
      const res = await request(ctx.app).post("/api/agent/commands").set(h()).send({ input: "what failed recently?" });
      expect(res.status).toBe(200);
      expect(res.body.mock).toBe(true);
      expect(res.body.actions[0]).toMatchObject({ tool: "list_jobs" });
    });
  });
});
