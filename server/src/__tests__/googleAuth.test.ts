import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../config";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { resetGoogleFetch, setGoogleFetch } from "../services/googleAuth";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function stubGoogleFetch(userInfo: Record<string, unknown>) {
  setGoogleFetch(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }
    if (url.includes("openidconnect.googleapis.com")) {
      return jsonResponse(userInfo);
    }
    throw new Error(`Unexpected fetch to ${url}`);
  });
}

async function getStateCookie(ctx: TestContext): Promise<{ cookie: string; state: string }> {
  const start = await request(ctx.app).get("/api/auth/google/start");
  expect(start.status).toBe(302);
  const setCookie = start.headers["set-cookie"] as unknown as string[];
  const stateCookie = setCookie.find((c) => c.startsWith("suprstar_oauth_state="))!;
  const state = new URL(start.headers.location).searchParams.get("state")!;
  return { cookie: stateCookie.split(";")[0], state };
}

describe("Google SSO", () => {
  let ctx: TestContext;
  const originalClientId = config.googleClientId;
  const originalClientSecret = config.googleClientSecret;

  beforeEach(() => {
    ctx = createTestContext();
    ctx.disableAuthBypass();
    config.googleClientId = "test-client-id";
    config.googleClientSecret = "test-client-secret";
  });

  afterEach(() => {
    cleanupTestContext(ctx);
    resetGoogleFetch();
    config.googleClientId = originalClientId;
    config.googleClientSecret = originalClientSecret;
  });

  it("returns 404 on both routes when Google is not configured", async () => {
    config.googleClientId = "";
    config.googleClientSecret = "";
    const start = await request(ctx.app).get("/api/auth/google/start");
    expect(start.status).toBe(404);
    expect(start.body.error).toMatch(/not configured/i);

    const callback = await request(ctx.app).get("/api/auth/google/callback?code=x&state=y");
    expect(callback.status).toBe(404);
  });

  it("reflects google:true on /auth/status once configured", async () => {
    const status = await request(ctx.app).get("/api/auth/status");
    expect(status.body.providers.google).toBe(true);
  });

  it("provisions an allowed-domain user, stores googleSub, and signs them in", async () => {
    const orgsRepo = new OrganizationsRepo(ctx.db);
    const org = orgsRepo.create({
      id: "org_f3i",
      name: "F3 Insights",
      slug: "f3i",
      brandColor: "#000000",
      timezone: "UTC",
      logoUrl: null,
      createdAt: new Date().toISOString(),
    });

    stubGoogleFetch({ sub: "google-sub-123", email: "person@f3insights.com", email_verified: true, name: "Person" });
    const { cookie, state } = await getStateCookie(ctx);

    const agent = request.agent(ctx.app);
    const callback = await agent
      .get(`/api/auth/google/callback?code=fake-code&state=${state}`)
      .set("Cookie", cookie);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe("http://localhost:5173/");

    const me = await agent.get("/api/auth/me");
    expect(me.body.user.email).toBe("person@f3insights.com");
    expect(me.body.user.role).toBe("editor");
    expect(me.body.user.orgIds).toEqual([org.id]);

    const record = new (await import("../db/repositories/users")).UsersRepo(ctx.db).getByEmail("person@f3insights.com")!;
    expect(record.googleSub).toBe("google-sub-123");
    expect(record.lastLoginAt).toBeTruthy();
  });

  it("rejects a mismatched or missing state cookie", async () => {
    stubGoogleFetch({ sub: "x", email: "person@f3insights.com", email_verified: true });
    const { state } = await getStateCookie(ctx);
    const badState = await request(ctx.app).get(`/api/auth/google/callback?code=fake-code&state=${state}`); // no cookie sent
    expect(badState.headers.location).toBe("http://localhost:5173/?auth=error&reason=state");

    const agent = request.agent(ctx.app);
    const start = await agent.get("/api/auth/google/start");
    const wrongState = start.headers.location; // has correct cookie set on agent
    void wrongState;
    const mismatched = await agent.get(`/api/auth/google/callback?code=fake-code&state=totally-wrong`);
    expect(mismatched.headers.location).toBe("http://localhost:5173/?auth=error&reason=state");
  });

  it("rejects an unverified email", async () => {
    stubGoogleFetch({ sub: "x", email: "person@f3insights.com", email_verified: false });
    const { cookie, state } = await getStateCookie(ctx);
    const callback = await request(ctx.app)
      .get(`/api/auth/google/callback?code=fake-code&state=${state}`)
      .set("Cookie", cookie);
    expect(callback.headers.location).toBe("http://localhost:5173/?auth=error&reason=google");
  });

  it("refuses a disallowed domain with reason=domain", async () => {
    stubGoogleFetch({ sub: "x", email: "person@example.com", email_verified: true });
    const { cookie, state } = await getStateCookie(ctx);
    const callback = await request(ctx.app)
      .get(`/api/auth/google/callback?code=fake-code&state=${state}`)
      .set("Cookie", cookie);
    expect(callback.headers.location).toBe("http://localhost:5173/?auth=error&reason=domain");
  });

  it("surfaces a token-exchange failure as reason=google", async () => {
    setGoogleFetch(async () => jsonResponse({ error: "invalid_grant" }, false, 400));
    const { cookie, state } = await getStateCookie(ctx);
    const callback = await request(ctx.app)
      .get(`/api/auth/google/callback?code=bad-code&state=${state}`)
      .set("Cookie", cookie);
    expect(callback.headers.location).toBe("http://localhost:5173/?auth=error&reason=google");
  });
});
