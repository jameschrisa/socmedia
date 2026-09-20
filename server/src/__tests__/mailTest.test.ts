import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../config";
import { _resetMailTestStateForTests, resetMailTestRateLimits } from "../services/mailer";
import { cleanupTestContext, createTestContext, TEST_OWNER_PASSWORD, type TestContext } from "./testApp";

describe("Mail self-test", () => {
  let ctx: TestContext;
  const originalProvider = config.mailProvider;
  const originalFrom = config.mailFrom;
  const originalResendKey = config.resendApiKey;

  beforeEach(() => {
    ctx = createTestContext();
    _resetMailTestStateForTests();
    resetMailTestRateLimits();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
    vi.unstubAllGlobals();
    _resetMailTestStateForTests();
    resetMailTestRateLimits();
    config.mailProvider = originalProvider;
    config.mailFrom = originalFrom;
    config.resendApiKey = originalResendKey;
  });

  describe("role guard", () => {
    beforeEach(() => {
      ctx.disableAuthBypass();
    });

    it("viewer and editor get 403 on both routes", async () => {
      const ownerAgent = request.agent(ctx.app);
      await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
      await ownerAgent
        .post("/api/users")
        .send({ email: "editor@test.local", name: "Editor", role: "editor", orgIds: "*", password: "password123" });
      await ownerAgent
        .post("/api/users")
        .send({ email: "viewer@test.local", name: "Viewer", role: "viewer", orgIds: "*", password: "password123" });

      const editorAgent = request.agent(ctx.app);
      await editorAgent.post("/api/auth/login").send({ email: "editor@test.local", password: "password123" });
      const viewerAgent = request.agent(ctx.app);
      await viewerAgent.post("/api/auth/login").send({ email: "viewer@test.local", password: "password123" });

      expect((await editorAgent.get("/api/settings/mail")).status).toBe(403);
      expect((await viewerAgent.get("/api/settings/mail")).status).toBe(403);
      expect((await editorAgent.post("/api/settings/mail/test").send({ to: "someone@example.com" })).status).toBe(403);
      expect((await viewerAgent.post("/api/settings/mail/test").send({ to: "someone@example.com" })).status).toBe(403);

      expect((await ownerAgent.get("/api/settings/mail")).status).toBe(200);
    });
  });

  it("reports the status shape with no mail provider configured", async () => {
    config.mailProvider = "log";
    const res = await request(ctx.app).get("/api/settings/mail");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      provider: "log",
      configured: false,
      from: null,
      canSendMagicLinks: true, // outside production, the log fallback is good enough
      lastTestAt: null,
      lastTestOk: null,
      lastTestError: null,
    });
  });

  it("sends a real test message when a provider is configured and records the success", async () => {
    config.mailProvider = "resend";
    config.resendApiKey = "test-resend-key";
    config.mailFrom = "suprstar@example.com";
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.resend.com/emails");
      const body = JSON.parse(init.body as string);
      expect(body.to).toEqual(["person@f3insights.com"]);
      expect(body.subject).toMatch(/suprstar mail test/i);
      return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(ctx.app).post("/api/settings/mail/test").send({ to: "person@f3insights.com" });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({ provider: "resend", configured: true, lastTestOk: true, lastTestError: null });
    expect(res.body.lastTestAt).toBeTruthy();

    const status = await request(ctx.app).get("/api/settings/mail");
    expect(status.body).toMatchObject({ lastTestOk: true, lastTestError: null });
  });

  it("records a failing send's error without throwing, returning 200 with lastTestOk: false", async () => {
    config.mailProvider = "resend";
    config.resendApiKey = "test-resend-key";
    config.mailFrom = "suprstar@example.com";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "invalid api key" }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(ctx.app).post("/api/settings/mail/test").send({ to: "person@f3insights.com" });
    expect(res.status).toBe(200);
    expect(res.body.lastTestOk).toBe(false);
    expect(res.body.lastTestError).toContain("401");

    const status = await request(ctx.app).get("/api/settings/mail");
    expect(status.body.lastTestOk).toBe(false);
    expect(status.body.lastTestError).toContain("401");
  });

  it("is honest that a log-only send never reached an inbox", async () => {
    config.mailProvider = "log";
    const res = await request(ctx.app).post("/api/settings/mail/test").send({ to: "person@f3insights.com" });
    expect(res.status).toBe(200);
    expect(res.body.lastTestOk).toBe(true);
    expect(res.body.lastTestError).toMatch(/activity log/i);
  });

  it("rate limits repeated test sends to a handful per hour", async () => {
    config.mailProvider = "log";
    for (let i = 0; i < 5; i++) {
      const res = await request(ctx.app).post("/api/settings/mail/test").send({ to: "person@f3insights.com" });
      expect(res.status).toBe(200);
    }
    const limited = await request(ctx.app).post("/api/settings/mail/test").send({ to: "person@f3insights.com" });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatch(/too many/i);
  });
});
