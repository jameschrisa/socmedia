import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsersRepo } from "../db/repositories/users";
import { resetMagicLinkRateLimits } from "../services/magicLink";
import { hashPassword } from "../services/auth";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

function tokenFromLink(link: string): string {
  return new URL(link).searchParams.get("token")!;
}

describe("magic link sign-in", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
    ctx.disableAuthBypass();
    resetMagicLinkRateLimits();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  it("provisions an allowed-domain user, signs them in, and the link is single-use", async () => {
    const status = await request(ctx.app).get("/api/auth/status");
    expect(status.body.providers).toEqual({ password: true, magicLink: true, google: false });
    expect(status.body.allowedDomains).toEqual(["enelhealth.com", "f3insights.com"]);

    const orgsRepo = new (await import("../db/repositories/organizations")).OrganizationsRepo(ctx.db);
    const org = orgsRepo.create({
      id: "org_enel",
      name: "Enel Health",
      slug: "enel-health",
      brandColor: "#123456",
      timezone: "UTC",
      logoUrl: null,
      createdAt: new Date().toISOString(),
    });

    const req1 = await request(ctx.app).post("/api/auth/magic/request").send({ email: "new.person@enelhealth.com" });
    expect(req1.status).toBe(200);
    expect(req1.body.delivered).toBe("log");
    expect(typeof req1.body.link).toBe("string");

    const token = tokenFromLink(req1.body.link);
    const agent = request.agent(ctx.app);
    const verify = await agent.get(`/api/auth/magic/verify?token=${token}`);
    expect(verify.status).toBe(302);
    expect(verify.headers.location).toBe("http://localhost:5173/");
    expect(verify.headers["set-cookie"]?.some((c: string) => c.startsWith("suprstar_session="))).toBe(true);

    const me = await agent.get("/api/auth/me");
    expect(me.body.authenticated).toBe(true);
    expect(me.body.user.email).toBe("new.person@enelhealth.com");
    expect(me.body.user.role).toBe("editor");
    expect(me.body.user.orgIds).toEqual([org.id]);

    // second use of the same token fails
    const reuse = await request(ctx.app).get(`/api/auth/magic/verify?token=${token}`);
    expect(reuse.status).toBe(302);
    expect(reuse.headers.location).toBe("http://localhost:5173/?auth=error&reason=invalid");
  });

  it("rejects an unknown token as invalid and an expired one as expired", async () => {
    const bad = await request(ctx.app).get("/api/auth/magic/verify?token=not-a-real-token");
    expect(bad.headers.location).toBe("http://localhost:5173/?auth=error&reason=invalid");

    const { LoginTokensRepo } = await import("../db/repositories/loginTokens");
    const { hashMagicLinkToken } = await import("../services/magicLink");
    const repo = new LoginTokensRepo(ctx.db);
    const secret = "expired-secret-value-000000000000000000000";
    repo.create({
      id: "tok_expired",
      email: "someone@enelhealth.com",
      tokenHash: hashMagicLinkToken(secret),
      purpose: "magic",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const expired = await request(ctx.app).get(`/api/auth/magic/verify?token=${secret}`);
    expect(expired.headers.location).toBe("http://localhost:5173/?auth=error&reason=expired");
  });

  it("refuses a disallowed domain on request", async () => {
    const res = await request(ctx.app).post("/api/auth/magic/request").send({ email: "someone@example.com" });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe("domain");
    expect(res.body.error).toContain("@enelhealth.com");
    expect(res.body.link).toBeUndefined();
  });

  it("lets an already-invited user (any domain) request and use a magic link", async () => {
    const usersRepo = new UsersRepo(ctx.db);
    const invited = usersRepo.create({
      id: "u_invited",
      email: "invited@holistiplan.com",
      name: "Invited",
      role: "editor",
      orgIds: [ctx.orgId],
      passwordHash: hashPassword("some-temp-password"),
      active: true,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    });

    const req1 = await request(ctx.app).post("/api/auth/magic/request").send({ email: invited.email });
    const token = tokenFromLink(req1.body.link);
    const agent = request.agent(ctx.app);
    const verify = await agent.get(`/api/auth/magic/verify?token=${token}`);
    expect(verify.headers.location).toBe("http://localhost:5173/");
    const me = await agent.get("/api/auth/me");
    expect(me.body.user.email).toBe(invited.email);
  });

  it("refuses a deactivated user with reason=inactive", async () => {
    const usersRepo = new UsersRepo(ctx.db);
    const deactivated = usersRepo.create({
      id: "u_deactivated",
      email: "gone@enelhealth.com",
      name: "Gone",
      role: "editor",
      orgIds: [ctx.orgId],
      passwordHash: hashPassword("whatever-password"),
      active: false,
      mustChangePassword: false,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    });

    const req1 = await request(ctx.app).post("/api/auth/magic/request").send({ email: deactivated.email });
    expect(req1.status).toBe(403);
    expect(req1.body.reason).toBe("inactive");

    // A token minted before deactivation is still refused at verify time.
    usersRepo.update(deactivated.id, { active: true });
    const req2 = await request(ctx.app).post("/api/auth/magic/request").send({ email: deactivated.email });
    const token = tokenFromLink(req2.body.link);
    usersRepo.update(deactivated.id, { active: false });
    const verify = await request(ctx.app).get(`/api/auth/magic/verify?token=${token}`);
    expect(verify.headers.location).toBe("http://localhost:5173/?auth=error&reason=inactive");
  });

  it("rate limits repeated requests for the same email", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(ctx.app).post("/api/auth/magic/request").send({ email: "loop@enelhealth.com" });
      expect(res.status).toBe(200);
    }
    const sixth = await request(ctx.app).post("/api/auth/magic/request").send({ email: "loop@enelhealth.com" });
    expect(sixth.status).toBe(429);
  });
});
