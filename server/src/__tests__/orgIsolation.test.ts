import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { log } from "../services/logger";
import { resetMagicLinkRateLimits } from "../services/magicLink";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

/**
 * A user on an allowed sign-in domain must only ever reach the organizations that domain's policy
 * entry names. The shipped policy puts enelhealth.com on Enel Health and f3insights.com on F3i, so
 * these tests sign someone in through the real magic-link path and then try, from that session, to
 * reach the other organization through every surface that is not behind the org middleware.
 */

function tokenFromLink(link: string): string {
  return new URL(link).searchParams.get("token")!;
}

describe("organization isolation", () => {
  let ctx: TestContext;
  let enelId: string;
  let f3iId: string;

  beforeEach(() => {
    ctx = createTestContext();
    ctx.disableAuthBypass();
    resetMagicLinkRateLimits();
    const orgsRepo = new OrganizationsRepo(ctx.db);
    const now = new Date().toISOString();
    enelId = orgsRepo.create({
      id: "org_enel",
      name: "Enel Health",
      slug: "enel-health",
      brandColor: "#123456",
      timezone: "UTC",
      logoUrl: null,
      createdAt: now,
    }).id;
    f3iId = orgsRepo.create({
      id: "org_f3i",
      name: "F3i",
      slug: "f3i",
      brandColor: "#654321",
      timezone: "UTC",
      logoUrl: null,
      createdAt: now,
    }).id;
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  /** Signs `email` in through the real magic-link flow and returns a cookie-bearing agent. */
  async function signInVia(email: string) {
    const requested = await request(ctx.app).post("/api/auth/magic/request").send({ email });
    expect(requested.status).toBe(200);
    const agent = request.agent(ctx.app);
    const verify = await agent.get(`/api/auth/magic/verify?token=${tokenFromLink(requested.body.link)}`);
    expect(verify.headers.location).toBe("http://localhost:5173/");
    return agent;
  }

  it("provisions an enelhealth.com user as an editor scoped to Enel Health alone", async () => {
    const agent = await signInVia("nurse@enelhealth.com");
    const me = await agent.get("/api/auth/me");
    expect(me.body.user.role).toBe("editor");
    expect(me.body.user.orgIds).toEqual([enelId]);
  });

  it("lists only Enel Health for an enelhealth.com user, and 404s the other org by id", async () => {
    const agent = await signInVia("nurse@enelhealth.com");

    const list = await agent.get("/api/orgs");
    expect(list.status).toBe(200);
    expect(list.body.map((o: { id: string }) => o.id)).toEqual([enelId]);
    // The name of an organization they cannot reach must not leak through the switcher either.
    expect(JSON.stringify(list.body)).not.toContain("F3i");

    expect((await agent.get(`/api/orgs/${enelId}`)).status).toBe(200);
    expect((await agent.get(`/api/orgs/${f3iId}`)).status).toBe(404);
  });

  it("refuses every org-scoped route when the header names an organization they are not in", async () => {
    const agent = await signInVia("nurse@enelhealth.com");
    const scopedPaths = ["/api/posts", "/api/media", "/api/jobs", "/api/analytics/summary", "/api/connections"];

    for (const path of scopedPaths) {
      const mine = await agent.get(path).set("X-Org-Id", enelId);
      expect(mine.status, `${path} with their own org`).not.toBe(403);

      const theirs = await agent.get(path).set("X-Org-Id", f3iId);
      expect(theirs.status, `${path} with another org`).toBe(403);
      expect(theirs.body.error).toMatch(/do not have access/i);
    }
  });

  it("refuses the orgId query parameter as readily as the header", async () => {
    const agent = await signInVia("nurse@enelhealth.com");
    const res = await agent.get(`/api/posts?orgId=${f3iId}`);
    expect(res.status).toBe(403);
  });

  it("refuses another organization on the inbound routes, which carry their own org checks", async () => {
    const agent = await signInVia("nurse@enelhealth.com");

    expect((await agent.get("/api/inbound/bindings").set("X-Org-Id", enelId)).status).toBe(200);
    expect((await agent.get("/api/inbound/bindings").set("X-Org-Id", f3iId)).status).toBe(403);
    expect((await agent.get("/api/inbound/messages").set("X-Org-Id", f3iId)).status).toBe(403);
  });

  it("keeps another organization's activity out of the log an editor can read", async () => {
    const agent = await signInVia("nurse@enelhealth.com");
    log.info("posts", "Enel Health post published", { orgId: enelId });
    log.info("posts", "F3i post published", { orgId: f3iId });

    const res = await agent.get("/api/logs?limit=200");
    expect(res.status).toBe(200);
    const messages = res.body.entries.map((e: { message: string }) => e.message);
    expect(messages).toContain("Enel Health post published");
    expect(messages).not.toContain("F3i post published");
  });

  it("gives an editor no route to widen their own access", async () => {
    const agent = await signInVia("nurse@enelhealth.com");

    // The user admin surfaces are admin+, so they cannot grant themselves another org...
    expect((await agent.get("/api/users")).status).toBe(403);
    expect((await agent.get("/api/settings/access-policy")).status).toBe(403);
    // ...nor edit the domain policy that decided their scope, nor create an org to sidestep it.
    expect((await agent.put("/api/settings/access-policy").send({ domains: [], allowInvitedUsersAnyDomain: true })).status).toBe(403);
    expect((await agent.post("/api/orgs").send({ name: "Mine", brandColor: "#000000", timezone: "UTC" })).status).toBe(403);
  });

  it("confines a scoped admin as tightly as an editor, on the routes that key off role", async () => {
    // The access policy can map a domain to admin, and admins see every organization's activity
    // log and inbound channels. That bypass must key off orgIds, not the role alone, or an admin
    // scoped to one organization would be a way around the isolation every other route enforces.
    const usersRepo = new (await import("../db/repositories/users")).UsersRepo(ctx.db);
    const { hashPassword } = await import("../services/auth");
    usersRepo.create({
      id: "u_scoped_admin",
      email: "admin@enelhealth.com",
      name: "Scoped Admin",
      role: "admin",
      orgIds: [enelId],
      passwordHash: hashPassword("password123"),
      active: true,
      mustChangePassword: false,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    });
    const agent = request.agent(ctx.app);
    await agent.post("/api/auth/login").send({ email: "admin@enelhealth.com", password: "password123" });

    log.info("posts", "Enel Health admin-visible line", { orgId: enelId });
    log.info("posts", "F3i admin-visible line", { orgId: f3iId });
    const logs = await agent.get("/api/logs?limit=200");
    const messages = logs.body.entries.map((e: { message: string }) => e.message);
    expect(messages).toContain("Enel Health admin-visible line");
    expect(messages).not.toContain("F3i admin-visible line");

    // The unscoped inbound listing is for admins who actually hold every organization.
    expect((await agent.get("/api/inbound/bindings").set("X-Org-Id", f3iId)).status).toBe(403);
    expect((await agent.get("/api/inbound/messages").set("X-Org-Id", f3iId)).status).toBe(403);
    expect((await agent.get("/api/orgs")).body.map((o: { id: string }) => o.id)).toEqual([enelId]);
  });

  it("still gives an admin who holds every organization the unscoped views", async () => {
    // ctx.owner has orgIds "*", so the role-based shortcuts must still apply to them.
    const agent = request.agent(ctx.app);
    await agent.post("/api/auth/login").send({ email: "owner@test.local", password: "password123" });

    log.info("posts", "Cross-org line for an unscoped owner", { orgId: f3iId });
    const logs = await agent.get("/api/logs?limit=200");
    expect(logs.body.entries.map((e: { message: string }) => e.message)).toContain("Cross-org line for an unscoped owner");
    expect((await agent.get("/api/inbound/bindings")).status).toBe(200);
  });

  it("scopes an f3insights.com user to F3i the same way, in the other direction", async () => {
    const agent = await signInVia("analyst@f3insights.com");

    const me = await agent.get("/api/auth/me");
    expect(me.body.user.orgIds).toEqual([f3iId]);

    const list = await agent.get("/api/orgs");
    expect(list.body.map((o: { id: string }) => o.id)).toEqual([f3iId]);
    expect((await agent.get("/api/posts").set("X-Org-Id", enelId)).status).toBe(403);
  });
});
