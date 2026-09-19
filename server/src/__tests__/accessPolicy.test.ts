import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { TEST_OWNER_PASSWORD, cleanupTestContext, createTestContext, type TestContext } from "./testApp";

describe("access policy settings", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
    ctx.disableAuthBypass();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  async function ownerAgent() {
    const agent = request.agent(ctx.app);
    await agent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
    return agent;
  }

  it("returns the default policy", async () => {
    const agent = await ownerAgent();
    const res = await agent.get("/api/settings/access-policy");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      domains: [
        { domain: "enelhealth.com", role: "editor", orgSlugs: ["enel-health"] },
        { domain: "f3insights.com", role: "editor", orgSlugs: ["f3i"] },
      ],
      allowInvitedUsersAnyDomain: true,
    });
  });

  it("updates the policy when orgSlugs exist, and round-trips it", async () => {
    const orgsRepo = new OrganizationsRepo(ctx.db);
    orgsRepo.create({
      id: "org_holistiplan",
      name: "Holistiplan",
      slug: "holistiplan",
      brandColor: "#ffffff",
      timezone: "UTC",
      logoUrl: null,
      createdAt: new Date().toISOString(),
    });

    const agent = await ownerAgent();
    const put = await agent.put("/api/settings/access-policy").send({
      domains: [{ domain: "holistiplan.com", role: "viewer", orgSlugs: ["holistiplan"] }],
      allowInvitedUsersAnyDomain: false,
    });
    expect(put.status).toBe(200);
    expect(put.body.domains).toEqual([{ domain: "holistiplan.com", role: "viewer", orgSlugs: ["holistiplan"] }]);
    expect(put.body.allowInvitedUsersAnyDomain).toBe(false);

    const get = await agent.get("/api/settings/access-policy");
    expect(get.body).toEqual(put.body);

    const status = await request(ctx.app).get("/api/auth/status");
    expect(status.body.allowedDomains).toEqual(["holistiplan.com"]);
  });

  it("400s on an orgSlug that doesn't exist", async () => {
    const agent = await ownerAgent();
    const res = await agent.put("/api/settings/access-policy").send({
      domains: [{ domain: "ghost.com", role: "editor", orgSlugs: ["no-such-org"] }],
    });
    expect(res.status).toBe(400);
  });

  it("accepts orgSlugs: '*' without checking any org", async () => {
    const agent = await ownerAgent();
    const res = await agent.put("/api/settings/access-policy").send({
      domains: [{ domain: "anywhere.com", role: "editor", orgSlugs: "*" }],
    });
    expect(res.status).toBe(200);
    expect(res.body.domains[0].orgSlugs).toBe("*");
  });

  it("rejects a role of owner at the schema level", async () => {
    const agent = await ownerAgent();
    const res = await agent.put("/api/settings/access-policy").send({
      domains: [{ domain: "sneaky.com", role: "owner", orgSlugs: "*" }],
    });
    expect(res.status).toBe(400);
  });

  it("requires admin+ to read or write the policy", async () => {
    const agent = await ownerAgent();
    await agent.post("/api/users").send({ email: "viewer2@test.local", name: "Viewer", role: "viewer", orgIds: "*", password: "password123" });

    const viewerAgent = request.agent(ctx.app);
    await viewerAgent.post("/api/auth/login").send({ email: "viewer2@test.local", password: "password123" });

    const get = await viewerAgent.get("/api/settings/access-policy");
    expect(get.status).toBe(403);
    const put = await viewerAgent.put("/api/settings/access-policy").send({ domains: [] });
    expect(put.status).toBe(403);
  });
});
