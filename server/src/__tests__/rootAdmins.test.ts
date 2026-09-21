import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../config";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { UsersRepo } from "../db/repositories/users";
import { resetMagicLinkRateLimits } from "../services/magicLink";
import { ensureRootAdmins, isRootAdmin } from "../services/rootAdmins";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

/**
 * Root administrators come from ROOT_ADMIN_EMAILS on the host. They are always owners over every
 * organization, and nothing reachable from inside the app can take that away. The point of the
 * environment variable is that granting root needs host access, not an admin session.
 */

const ROOT = "james@f3insights.com";
const ROOT_TWO = "james@enelhealth.com";

function tokenFromLink(link: string): string {
  return new URL(link).searchParams.get("token")!;
}

describe("root administrators", () => {
  let ctx: TestContext;
  let enelId: string;
  let f3iId: string;
  const originalRoots = config.rootAdminEmails;

  beforeEach(() => {
    ctx = createTestContext();
    resetMagicLinkRateLimits();
    config.rootAdminEmails = [ROOT, ROOT_TWO];
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
    config.rootAdminEmails = originalRoots;
    cleanupTestContext(ctx);
  });

  async function signInVia(email: string) {
    const requested = await request(ctx.app).post("/api/auth/magic/request").send({ email });
    expect(requested.status).toBe(200);
    const agent = request.agent(ctx.app);
    await agent.get(`/api/auth/magic/verify?token=${tokenFromLink(requested.body.link)}`);
    return agent;
  }

  it("recognises only the configured addresses", () => {
    expect(isRootAdmin(ROOT)).toBe(true);
    expect(isRootAdmin("JAMES@F3INSIGHTS.COM")).toBe(true);
    expect(isRootAdmin("someone.else@f3insights.com")).toBe(false);
    expect(isRootAdmin("")).toBe(false);
    expect(isRootAdmin(null)).toBe(false);
  });

  it("creates a missing root administrator as an owner over every organization", () => {
    ensureRootAdmins(ctx.db);
    const user = new UsersRepo(ctx.db).getByEmail(ROOT_TWO)!;
    expect(user.role).toBe("owner");
    expect(user.orgIds).toBe("*");
    expect(user.active).toBe(true);
  });

  it("repairs a root administrator that was demoted, narrowed or deactivated", () => {
    const usersRepo = new UsersRepo(ctx.db);
    ensureRootAdmins(ctx.db);
    const before = usersRepo.getByEmail(ROOT)!;
    usersRepo.update(before.id, { role: "viewer", orgIds: [enelId], active: false, mustChangePassword: true });

    ensureRootAdmins(ctx.db);

    const after = usersRepo.getByEmail(ROOT)!;
    expect(after.role).toBe("owner");
    expect(after.orgIds).toBe("*");
    expect(after.active).toBe(true);
    expect(after.mustChangePassword).toBe(false);
    expect(after.id).toBe(before.id);
  });

  it("signs a root administrator in as an owner over everything, not as their domain's editor", async () => {
    ctx.disableAuthBypass();
    // enelhealth.com maps to editor on Enel Health alone. Root outranks that entry.
    const agent = await signInVia(ROOT_TWO);

    const me = await agent.get("/api/auth/me");
    expect(me.body.user.role).toBe("owner");
    expect(me.body.user.orgIds).toBe("*");

    // Every organization, including the harness's own, not just the two this test created.
    const orgs = await agent.get("/api/orgs");
    expect(orgs.body.map((o: { id: string }) => o.id).sort()).toEqual([enelId, f3iId, ctx.orgId].sort());
    expect((await agent.get("/api/posts").set("X-Org-Id", enelId)).status).toBe(200);
    expect((await agent.get("/api/posts").set("X-Org-Id", f3iId)).status).toBe(200);
  });

  it("lets a root administrator back in after being demoted and deactivated in the database", async () => {
    ctx.disableAuthBypass();
    const usersRepo = new UsersRepo(ctx.db);
    ensureRootAdmins(ctx.db);
    const before = usersRepo.getByEmail(ROOT)!;
    usersRepo.update(before.id, { role: "viewer", orgIds: [enelId], active: false });

    const agent = await signInVia(ROOT);

    const me = await agent.get("/api/auth/me");
    expect(me.body.authenticated).toBe(true);
    expect(me.body.user.role).toBe("owner");
    expect(me.body.user.orgIds).toBe("*");
  });

  it("refuses every in-app attempt to strip a root administrator", async () => {
    ensureRootAdmins(ctx.db);
    const usersRepo = new UsersRepo(ctx.db);
    const root = usersRepo.getByEmail(ROOT)!;
    // The seeded owner acts here: not even another owner may take root's access away.
    const agent = request(ctx.app);

    for (const body of [{ role: "viewer" }, { orgIds: [enelId] }, { active: false }]) {
      const res = await agent.patch(`/api/users/${root.id}`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.body.error).toMatch(/root administrator/i);
    }

    const del = await agent.delete(`/api/users/${root.id}`);
    expect(del.status).toBe(403);
    expect(del.body.error).toMatch(/root administrator/i);

    const unchanged = usersRepo.getByEmail(ROOT)!;
    expect(unchanged.role).toBe("owner");
    expect(unchanged.orgIds).toBe("*");
    expect(unchanged.active).toBe(true);
  });

  it("still allows a rename and a password reset, which change nothing about their reach", async () => {
    ensureRootAdmins(ctx.db);
    const usersRepo = new UsersRepo(ctx.db);
    const root = usersRepo.getByEmail(ROOT)!;

    const res = await request(ctx.app).patch(`/api/users/${root.id}`).send({ name: "James", password: "a-new-password" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("James");
    expect(usersRepo.getByEmail(ROOT)!.orgIds).toBe("*");
  });

  it("leaves everyone else on the same domain scoped to their one organization", async () => {
    ctx.disableAuthBypass();
    const agent = await signInVia("someone.else@enelhealth.com");

    const me = await agent.get("/api/auth/me");
    expect(me.body.user.role).toBe("editor");
    expect(me.body.user.orgIds).toEqual([enelId]);
    expect((await agent.get("/api/posts").set("X-Org-Id", f3iId)).status).toBe(403);
  });

  it("does nothing at all when ROOT_ADMIN_EMAILS is unset", () => {
    config.rootAdminEmails = [];
    const usersRepo = new UsersRepo(ctx.db);
    const before = usersRepo.count();
    ensureRootAdmins(ctx.db);
    expect(usersRepo.count()).toBe(before);
    expect(isRootAdmin(ROOT)).toBe(false);
  });
});
