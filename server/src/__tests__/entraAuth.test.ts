import crypto from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../config";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { UsersRepo } from "../db/repositories/users";
import { resetEntraFetch, resetEntraJwksCache, setEntraFetch } from "../services/entraAuth";
import { hashPassword } from "../services/auth";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const KID = "test-key-1";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const { publicKey: otherPublicKey, privateKey: otherPrivateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
void otherPublicKey;

function jwkForKeys() {
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  return { ...jwk, kid: KID, use: "sig", alg: "RS256" };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signIdToken(claims: Record<string, unknown>, opts: { signingKey?: crypto.KeyObject; kid?: string } = {}): string {
  const header = { alg: "RS256", typ: "JWT", kid: opts.kid ?? KID };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(claims));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${headerB64}.${payloadB64}`);
  const signature = signer.sign(opts.signingKey ?? privateKey);
  return `${headerB64}.${payloadB64}.${base64url(signature)}`;
}

function defaultClaims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    aud: config.entraClientId,
    iss: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    tid: TENANT_ID,
    oid: "entra-oid-123",
    sub: "entra-sub-fallback",
    email: "person@f3insights.com",
    name: "Person",
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function stubEntraFetch(idToken: string, opts: { jwks?: unknown } = {}) {
  setEntraFetch(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/oauth2/v2.0/token")) {
      return jsonResponse({ access_token: "fake-access-token", id_token: idToken });
    }
    if (url.includes("/discovery/v2.0/keys")) {
      return jsonResponse(opts.jwks ?? { keys: [jwkForKeys()] });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  });
}

async function getStateCookie(ctx: TestContext): Promise<{ cookie: string; state: string; nonce: string }> {
  const start = await request(ctx.app).get("/api/auth/entra/start");
  expect(start.status).toBe(302);
  const setCookie = start.headers["set-cookie"] as unknown as string[];
  const stateCookie = setCookie.find((c) => c.startsWith("suprstar_entra_state="))!;
  const location = new URL(start.headers.location);
  const state = location.searchParams.get("state")!;
  const nonce = location.searchParams.get("nonce")!;
  return { cookie: stateCookie.split(";")[0], state, nonce };
}

describe("Microsoft Entra ID SSO", () => {
  let ctx: TestContext;
  const originalClientId = config.entraClientId;
  const originalClientSecret = config.entraClientSecret;
  const originalTenantId = config.entraTenantId;

  beforeEach(() => {
    ctx = createTestContext();
    ctx.disableAuthBypass();
    config.entraClientId = "test-entra-client-id";
    config.entraClientSecret = "test-entra-client-secret";
    config.entraTenantId = TENANT_ID;
    resetEntraJwksCache();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
    resetEntraFetch();
    resetEntraJwksCache();
    config.entraClientId = originalClientId;
    config.entraClientSecret = originalClientSecret;
    config.entraTenantId = originalTenantId;
  });

  it("returns 404 on both routes when Entra is not configured", async () => {
    config.entraClientId = "";
    config.entraClientSecret = "";
    const start = await request(ctx.app).get("/api/auth/entra/start");
    expect(start.status).toBe(404);
    expect(start.body.error).toMatch(/not configured/i);

    const callback = await request(ctx.app).get("/api/auth/entra/callback?code=x&state=y");
    expect(callback.status).toBe(404);
  });

  it("302s to Entra's authorize endpoint with the right query params when configured", async () => {
    const start = await request(ctx.app).get("/api/auth/entra/start");
    expect(start.status).toBe(302);
    const location = new URL(start.headers.location);
    expect(location.origin + location.pathname).toBe(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`);
    expect(location.searchParams.get("client_id")).toBe("test-entra-client-id");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("response_mode")).toBe("query");
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:5173/api/auth/entra/callback");
    expect(location.searchParams.get("scope")).toBe("openid profile email");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("nonce")).toBeTruthy();
  });

  it("reflects entra:true/false on /auth/status depending on configuration", async () => {
    const configured = await request(ctx.app).get("/api/auth/status");
    expect(configured.body.providers.entra).toBe(true);

    config.entraClientId = "";
    const unconfigured = await request(ctx.app).get("/api/auth/status");
    expect(unconfigured.body.providers.entra).toBe(false);
  });

  it("provisions an allowed-domain user with an id_token, stores entraSub, and signs them in", async () => {
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

    const { cookie, state, nonce } = await getStateCookie(ctx);
    const idToken = signIdToken(defaultClaims({ nonce }));
    stubEntraFetch(idToken);

    const agent = request.agent(ctx.app);
    const callback = await agent.get(`/api/auth/entra/callback?code=fake-code&state=${state}`).set("Cookie", cookie);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe("http://localhost:5173/");

    const me = await agent.get("/api/auth/me");
    expect(me.body.user.email).toBe("person@f3insights.com");
    expect(me.body.user.role).toBe("editor");
    expect(me.body.user.orgIds).toEqual([org.id]);

    const record = new UsersRepo(ctx.db).getByEmail("person@f3insights.com")!;
    expect(record.entraSub).toBe("entra-oid-123");
    expect(record.lastLoginAt).toBeTruthy();
  });

  it("rejects a mismatched or missing state cookie with reason=state", async () => {
    const { state, nonce } = await getStateCookie(ctx);
    const idToken = signIdToken(defaultClaims({ nonce }));
    stubEntraFetch(idToken);

    const noCookie = await request(ctx.app).get(`/api/auth/entra/callback?code=fake-code&state=${state}`);
    expect(noCookie.headers.location).toBe("http://localhost:5173/?auth=error&reason=state");

    const agent = request.agent(ctx.app);
    await agent.get("/api/auth/entra/start");
    const mismatched = await agent.get(`/api/auth/entra/callback?code=fake-code&state=totally-wrong`);
    expect(mismatched.headers.location).toBe("http://localhost:5173/?auth=error&reason=state");
  });

  it("rejects a token with a bad signature with reason=entra", async () => {
    const { cookie, state, nonce } = await getStateCookie(ctx);
    const idToken = signIdToken(defaultClaims({ nonce }), { signingKey: otherPrivateKey });
    stubEntraFetch(idToken);
    const callback = await request(ctx.app).get(`/api/auth/entra/callback?code=fake-code&state=${state}`).set("Cookie", cookie);
    expect(callback.headers.location).toBe("http://localhost:5173/?auth=error&reason=entra");
  });

  it("rejects a token with the wrong aud with reason=entra", async () => {
    const { cookie, state, nonce } = await getStateCookie(ctx);
    const idToken = signIdToken(defaultClaims({ nonce, aud: "someone-elses-client-id" }));
    stubEntraFetch(idToken);
    const callback = await request(ctx.app).get(`/api/auth/entra/callback?code=fake-code&state=${state}`).set("Cookie", cookie);
    expect(callback.headers.location).toBe("http://localhost:5173/?auth=error&reason=entra");
  });

  it("rejects a token with the wrong tid with reason=entra", async () => {
    const { cookie, state, nonce } = await getStateCookie(ctx);
    const idToken = signIdToken(defaultClaims({ nonce, tid: "99999999-9999-9999-9999-999999999999" }));
    stubEntraFetch(idToken);
    const callback = await request(ctx.app).get(`/api/auth/entra/callback?code=fake-code&state=${state}`).set("Cookie", cookie);
    expect(callback.headers.location).toBe("http://localhost:5173/?auth=error&reason=entra");
  });

  it("rejects an expired token with reason=entra", async () => {
    const { cookie, state, nonce } = await getStateCookie(ctx);
    const idToken = signIdToken(defaultClaims({ nonce, exp: Math.floor(Date.now() / 1000) - 3600 }));
    stubEntraFetch(idToken);
    const callback = await request(ctx.app).get(`/api/auth/entra/callback?code=fake-code&state=${state}`).set("Cookie", cookie);
    expect(callback.headers.location).toBe("http://localhost:5173/?auth=error&reason=entra");
  });

  it("rejects a mismatched nonce with reason=entra", async () => {
    const { cookie, state } = await getStateCookie(ctx);
    const idToken = signIdToken(defaultClaims({ nonce: "some-other-nonce" }));
    stubEntraFetch(idToken);
    const callback = await request(ctx.app).get(`/api/auth/entra/callback?code=fake-code&state=${state}`).set("Cookie", cookie);
    expect(callback.headers.location).toBe("http://localhost:5173/?auth=error&reason=entra");
  });

  it("refuses a disallowed domain with reason=domain", async () => {
    const { cookie, state, nonce } = await getStateCookie(ctx);
    const idToken = signIdToken(defaultClaims({ nonce, email: "person@example.com" }));
    stubEntraFetch(idToken);
    const callback = await request(ctx.app).get(`/api/auth/entra/callback?code=fake-code&state=${state}`).set("Cookie", cookie);
    expect(callback.headers.location).toBe("http://localhost:5173/?auth=error&reason=domain");
  });

  it("refuses a deactivated user with reason=inactive", async () => {
    const usersRepo = new UsersRepo(ctx.db);
    usersRepo.create({
      id: "deactivated-user",
      email: "gone@f3insights.com",
      name: "Gone",
      role: "editor",
      orgIds: [],
      passwordHash: hashPassword("whatever-unused"),
      active: false,
      mustChangePassword: false,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    });

    const { cookie, state, nonce } = await getStateCookie(ctx);
    const idToken = signIdToken(defaultClaims({ nonce, email: "gone@f3insights.com" }));
    stubEntraFetch(idToken);
    const callback = await request(ctx.app).get(`/api/auth/entra/callback?code=fake-code&state=${state}`).set("Cookie", cookie);
    expect(callback.headers.location).toBe("http://localhost:5173/?auth=error&reason=inactive");
  });

  it("surfaces a token-exchange failure as reason=entra", async () => {
    setEntraFetch(async () => jsonResponse({ error: "invalid_grant" }, false, 400));
    const { cookie, state } = await getStateCookie(ctx);
    const callback = await request(ctx.app).get(`/api/auth/entra/callback?code=bad-code&state=${state}`).set("Cookie", cookie);
    expect(callback.headers.location).toBe("http://localhost:5173/?auth=error&reason=entra");
  });

  it("clears a pending password change when an invited user signs in through Microsoft", async () => {
    const usersRepo = new UsersRepo(ctx.db);
    const invited = usersRepo.create({
      id: "u_sso_invited",
      email: "james@f3insights.com",
      name: "James",
      role: "owner",
      orgIds: "*",
      passwordHash: hashPassword("temporary-password-123"),
      active: true,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    });
    expect(usersRepo.get(invited.id)!.mustChangePassword).toBe(true);

    const { resolveSignOnUser } = await import("../services/signOn");
    const outcome = resolveSignOnUser(ctx.db, "James@F3insights.com");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.provisioned).toBe(false);
      // The role survives: a federated sign-in must not downgrade an owner to the domain's default.
      expect(outcome.user.role).toBe("owner");
      expect(outcome.user.mustChangePassword).toBe(false);
    }
    expect(usersRepo.get(invited.id)!.mustChangePassword).toBe(false);
  });
});
