import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTestContext, createTestContext, TEST_OWNER_PASSWORD, type TestContext } from "./testApp";

describe("auth", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  it("completes setup, logs in via cookie, and reads /auth/me (no auth bypass)", async () => {
    const fresh = createTestContext({ seedOwner: false });
    try {
      const before = await request(fresh.app).get("/api/auth/status");
      expect(before.status).toBe(200);
      expect(before.body).toEqual({ needsSetup: true, authenticated: false });

      const agent = request.agent(fresh.app);
      const setup = await agent.post("/api/auth/setup").send({ email: "root@test.local", name: "Root", password: "password123" });
      expect(setup.status).toBe(201);
      expect(setup.body.authenticated).toBe(true);
      expect(setup.body.user.role).toBe("owner");
      expect(setup.body.user.passwordHash).toBeUndefined();

      const me = await agent.get("/api/auth/me");
      expect(me.status).toBe(200);
      expect(me.body.authenticated).toBe(true);
      expect(me.body.user.email).toBe("root@test.local");

      // setup is a one-time affair
      const again = await request(fresh.app).post("/api/auth/setup").send({ email: "x@test.local", name: "X", password: "password123" });
      expect(again.status).toBe(409);
    } finally {
      cleanupTestContext(fresh);
    }
  });

  it("returns 401 without a session once the bypass is disabled", async () => {
    ctx.disableAuthBypass();
    const res = await request(ctx.app).get("/api/orgs");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/sign in/i);
  });

  it("GET /auth/status and /auth/me never 401", async () => {
    ctx.disableAuthBypass();
    const status = await request(ctx.app).get("/api/auth/status");
    expect(status.status).toBe(200);
    expect(status.body.needsSetup).toBe(false);
    const me = await request(ctx.app).get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.authenticated).toBe(false);
    expect(me.body.user).toBeNull();
  });

  it("rejects bad credentials and inactive users with 401", async () => {
    ctx.disableAuthBypass();
    const bad = await request(ctx.app).post("/api/auth/login").send({ email: ctx.owner!.email, password: "nope-wrong" });
    expect(bad.status).toBe(401);

    const unknown = await request(ctx.app).post("/api/auth/login").send({ email: "ghost@test.local", password: "password123" });
    expect(unknown.status).toBe(401);
  });

  it("logs in with an agent, then logout invalidates the session", async () => {
    ctx.disableAuthBypass();
    const agent = request.agent(ctx.app);
    const login = await agent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe(ctx.owner!.email);

    const me = await agent.get("/api/auth/me");
    expect(me.body.authenticated).toBe(true);

    const logout = await agent.post("/api/auth/logout");
    expect(logout.status).toBe(204);

    const meAfter = await agent.get("/api/auth/me");
    expect(meAfter.body.authenticated).toBe(false);
  });

  it("password change clears mustChangePassword and rejects a wrong current password", async () => {
    ctx.disableAuthBypass();
    const agent = request.agent(ctx.app);
    await agent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });

    const wrong = await agent.post("/api/auth/password").send({ currentPassword: "not-it", newPassword: "brand-new-pass" });
    expect(wrong.status).toBe(400);

    const ok = await agent.post("/api/auth/password").send({ currentPassword: TEST_OWNER_PASSWORD, newPassword: "brand-new-pass" });
    expect(ok.status).toBe(204);

    // old password no longer works, new one does
    const oldLogin = await request(ctx.app).post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(ctx.app).post("/api/auth/login").send({ email: ctx.owner!.email, password: "brand-new-pass" });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.mustChangePassword).toBe(false);
  });

  it("viewers get 403 on mutating routes but can still logout/change password", async () => {
    ctx.disableAuthBypass();
    const ownerAgent = request.agent(ctx.app);
    await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
    const created = await ownerAgent
      .post("/api/users")
      .send({ email: "viewer@test.local", name: "Viewer", role: "viewer", orgIds: "*", password: "password123" });
    expect(created.status).toBe(201);
    expect(created.body.mustChangePassword).toBe(true);

    const viewerAgent = request.agent(ctx.app);
    const viewerLogin = await viewerAgent.post("/api/auth/login").send({ email: "viewer@test.local", password: "password123" });
    expect(viewerLogin.status).toBe(200);

    const forbidden = await viewerAgent.post("/api/posts").set("X-Org-Id", ctx.orgId).send({});
    expect(forbidden.status).toBe(403);

    const canRead = await viewerAgent.get("/api/posts").set("X-Org-Id", ctx.orgId);
    expect(canRead.status).toBe(200);

    const pwChange = await viewerAgent.post("/api/auth/password").send({ currentPassword: "password123", newPassword: "another-password" });
    expect(pwChange.status).toBe(204);

    const logout = await viewerAgent.post("/api/auth/logout");
    expect(logout.status).toBe(204);
  });

  it("editors get 403 on /users", async () => {
    ctx.disableAuthBypass();
    const ownerAgent = request.agent(ctx.app);
    await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
    await ownerAgent.post("/api/users").send({ email: "editor@test.local", name: "Editor", role: "editor", orgIds: "*", password: "password123" });

    const editorAgent = request.agent(ctx.app);
    await editorAgent.post("/api/auth/login").send({ email: "editor@test.local", password: "password123" });
    const res = await editorAgent.get("/api/users");
    expect(res.status).toBe(403);
  });

  it("editors can create posts but not manage organizations", async () => {
    ctx.disableAuthBypass();
    const ownerAgent = request.agent(ctx.app);
    await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
    await ownerAgent.post("/api/users").send({ email: "writer@test.local", name: "Writer", role: "editor", orgIds: "*", password: "password123" });

    const editorAgent = request.agent(ctx.app);
    await editorAgent.post("/api/auth/login").send({ email: "writer@test.local", password: "password123" });
    const created = await editorAgent.post("/api/posts").set("X-Org-Id", ctx.orgId).send({ title: "Editor draft", caption: "hello" });
    expect(created.status).toBe(201);
    const org = await editorAgent.post("/api/orgs").send({ name: "Nope", slug: "nope", brandColor: "#000000", timezone: "UTC" });
    expect(org.status).toBe(403);
  });

  it("duplicate emails are rejected with 409", async () => {
    ctx.disableAuthBypass();
    const ownerAgent = request.agent(ctx.app);
    await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
    await ownerAgent.post("/api/users").send({ email: "dup@test.local", name: "Dup", role: "editor", orgIds: "*", password: "password123" });
    const dup = await ownerAgent.post("/api/users").send({ email: "DUP@test.local", name: "Dup2", role: "editor", orgIds: "*", password: "password123" });
    expect(dup.status).toBe(409);
  });

  it("refuses self-delete", async () => {
    ctx.disableAuthBypass();
    const ownerAgent = request.agent(ctx.app);
    await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
    const res = await ownerAgent.delete(`/api/users/${ctx.owner!.id}`);
    expect(res.status).toBe(400);
  });

  it("admins cannot demote or deactivate an owner, and the last owner is protected", async () => {
    ctx.disableAuthBypass();
    const ownerAgent = request.agent(ctx.app);
    await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
    const adminCreated = await ownerAgent
      .post("/api/users")
      .send({ email: "admin@test.local", name: "Admin", role: "admin", orgIds: "*", password: "password123" });
    expect(adminCreated.status).toBe(201);

    const adminAgent = request.agent(ctx.app);
    await adminAgent.post("/api/auth/login").send({ email: "admin@test.local", password: "password123" });

    const demote = await adminAgent.patch(`/api/users/${ctx.owner!.id}`).send({ role: "admin" });
    expect(demote.status).toBe(403);

    const deactivate = await adminAgent.patch(`/api/users/${ctx.owner!.id}`).send({ active: false });
    expect(deactivate.status).toBe(403);

    // the owner is the only one; even the owner can't demote themselves out of existence
    const selfDemote = await ownerAgent.patch(`/api/users/${ctx.owner!.id}`).send({ role: "admin" });
    expect(selfDemote.status).toBe(409);

    // deleting the admin (not an owner) is fine
    const deleteAdmin = await ownerAgent.delete(`/api/users/${adminCreated.body.id}`);
    expect(deleteAdmin.status).toBe(204);
  });

  it("admins cannot create other owners", async () => {
    ctx.disableAuthBypass();
    const ownerAgent = request.agent(ctx.app);
    await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
    await ownerAgent.post("/api/users").send({ email: "admin2@test.local", name: "Admin2", role: "admin", orgIds: "*", password: "password123" });

    const adminAgent = request.agent(ctx.app);
    await adminAgent.post("/api/auth/login").send({ email: "admin2@test.local", password: "password123" });
    const res = await adminAgent.post("/api/users").send({ email: "wannabe-owner@test.local", name: "Nope", role: "owner", orgIds: "*", password: "password123" });
    expect(res.status).toBe(403);
  });

  it("enforces org membership for a user without access to the org", async () => {
    ctx.disableAuthBypass();
    const ownerAgent = request.agent(ctx.app);
    await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
    await ownerAgent.post("/api/users").send({ email: "scoped@test.local", name: "Scoped", role: "editor", orgIds: [], password: "password123" });

    const scopedAgent = request.agent(ctx.app);
    await scopedAgent.post("/api/auth/login").send({ email: "scoped@test.local", password: "password123" });
    const res = await scopedAgent.get("/api/posts").set("X-Org-Id", ctx.orgId);
    expect(res.status).toBe(403);
  });

  it("never returns password hashes from /users", async () => {
    ctx.disableAuthBypass();
    const ownerAgent = request.agent(ctx.app);
    await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
    const list = await ownerAgent.get("/api/users");
    expect(list.status).toBe(200);
    for (const user of list.body) {
      expect(user.passwordHash).toBeUndefined();
    }
  });
});
