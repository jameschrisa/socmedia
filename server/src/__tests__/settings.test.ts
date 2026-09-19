import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";
import { activeProvider, getAiSettings } from "../services/aiSettings";
import { structured } from "../services/aiProviders";
import { z } from "zod/v4";

describe("AI settings", () => {
  let ctx: TestContext;
  beforeEach(() => { ctx = createTestContext(); });
  afterEach(() => { cleanupTestContext(ctx); vi.unstubAllGlobals(); });

  it("defaults to the mock provider when nothing is configured", async () => {
    const res = await request(ctx.app).get("/api/settings/ai");
    expect(res.status).toBe(200);
    expect(res.body.anthropic.apiKey).toBe("");
    expect(res.body.moonshot.baseUrl).toBe("https://api.moonshot.ai/v1");
    expect(activeProvider(ctx.db).provider).toBe("mock");
    const health = await request(ctx.app).get("/api/health");
    expect(health.body.ai).toMatchObject({ configured: false, provider: "mock" });
  });

  it("saves keys encrypted, masks them, and ignores masked round-trips", async () => {
    const save = await request(ctx.app).put("/api/settings/ai").send({
      provider: "moonshot",
      moonshot: { apiKey: "sk-moon-1234abcd", model: "kimi-k3" },
      anthropic: { apiKey: "sk-ant-xyz98765", model: "claude-sonnet-5" },
    });
    expect(save.status).toBe(200);
    expect(save.body.provider).toBe("moonshot");
    expect(save.body.moonshot.apiKey).toBe("••••abcd");
    expect(save.body.anthropic.apiKey).toBe("••••8765");

    const raw = ctx.db.prepare("SELECT value FROM app_settings WHERE key = 'ai'").get() as { value: string };
    expect(raw.value).not.toContain("sk-moon-1234abcd");
    expect(raw.value).toContain("enc:");

    // masked values leave the secret untouched; model changes apply
    const again = await request(ctx.app).put("/api/settings/ai").send({ moonshot: { apiKey: "••••abcd", model: "kimi-k2.6" } });
    expect(again.body.moonshot.model).toBe("kimi-k2.6");
    expect(getAiSettings(ctx.db).moonshot.apiKey).toBe("sk-moon-1234abcd");

    const active = activeProvider(ctx.db);
    expect(active).toMatchObject({ provider: "moonshot", model: "kimi-k2.6", apiKey: "sk-moon-1234abcd" });

    // clearing a key falls back to mock
    await request(ctx.app).put("/api/settings/ai").send({ moonshot: { apiKey: "" } });
    expect(activeProvider(ctx.db).provider).toBe("mock");
  });

  it("switching provider to anthropic uses the anthropic key and model", async () => {
    await request(ctx.app).put("/api/settings/ai").send({ provider: "anthropic", anthropic: { apiKey: "sk-ant-abc", model: "claude-haiku-4-5" } });
    expect(activeProvider(ctx.db)).toMatchObject({ provider: "anthropic", model: "claude-haiku-4-5" });
    const health = await request(ctx.app).get("/api/health");
    expect(health.body.ai).toMatchObject({ configured: true, provider: "anthropic", model: "claude-haiku-4-5" });
  });

  it("rejects invalid provider values", async () => {
    const res = await request(ctx.app).put("/api/settings/ai").send({ provider: "openai" });
    expect(res.status).toBe(400);
  });

  it("test endpoint reports a missing key without calling out", async () => {
    const res = await request(ctx.app).post("/api/settings/ai/test").send({ provider: "moonshot" });
    expect(res.body).toMatchObject({ ok: false, provider: "moonshot" });
    expect(res.body.message).toMatch(/No Moonshot API key/);
  });

  it("calls Moonshot's OpenAI-compatible endpoint and validates the JSON", async () => {
    await request(ctx.app).put("/api/settings/ai").send({ provider: "moonshot", moonshot: { apiKey: "sk-moon-test", model: "kimi-k3" } });
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.moonshot.ai/v1/chat/completions");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-moon-test");
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("kimi-k3");
      expect(body.response_format).toEqual({ type: "json_object" });
      return new Response(JSON.stringify({ model: "kimi-k3", choices: [{ message: { content: "```json\n{\"hashtags\":[\"tax\",\"planning\"]}\n```" } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await structured(ctx.db, { schema: z.object({ hashtags: z.array(z.string()) }), schemaName: "h", system: "s", user: "u", maxTokens: 100 });
    expect(result).toEqual({ data: { hashtags: ["tax", "planning"] }, model: "kimi-k3", provider: "moonshot" });

    // AI route goes through the same path
    const res = await request(ctx.app).post("/api/ai/hashtags").set("X-Org-Id", ctx.orgId).send({ caption: "Tax season", platform: "linkedin" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hashtags: ["tax", "planning"], mock: false, model: "kimi-k3" });
  });

  it("surfaces Moonshot auth failures as 502", async () => {
    await request(ctx.app).put("/api/settings/ai").send({ provider: "moonshot", moonshot: { apiKey: "bad" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "invalid key" } }), { status: 401 })));
    const res = await request(ctx.app).post("/api/ai/hashtags").set("X-Org-Id", ctx.orgId).send({ caption: "Tax season", platform: "linkedin" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/rejected the API key/);
  });
});
