import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAccessRequestRateLimits } from "../services/accessRequests";
import { TEST_OWNER_PASSWORD, cleanupTestContext, createTestContext, type TestContext } from "./testApp";

describe("access requests", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
    ctx.disableAuthBypass();
    resetAccessRequestRateLimits();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  it("creates a request, rejects a duplicate pending request, then can be listed and approved by an admin", async () => {
    const created = await request(ctx.app).post("/api/auth/access-requests").send({
      name: "Jordan Requester",
      email: "jordan@example.com",
      organization: "Example Co",
      message: "Please let me in",
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("pending");
    expect(created.body.email).toBe("jordan@example.com");

    const dup = await request(ctx.app).post("/api/auth/access-requests").send({
      name: "Jordan Requester",
      email: "jordan@example.com",
    });
    expect(dup.status).toBe(409);

    const ownerAgent = request.agent(ctx.app);
    await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });

    const list = await ownerAgent.get("/api/users/access-requests");
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);

    const pendingOnly = await ownerAgent.get("/api/users/access-requests?status=pending");
    expect(pendingOnly.body.length).toBe(1);
    const declinedOnly = await ownerAgent.get("/api/users/access-requests?status=declined");
    expect(declinedOnly.body.length).toBe(0);

    const approve = await ownerAgent
      .post(`/api/users/access-requests/${created.body.id}/approve`)
      .send({ role: "editor", orgIds: [ctx.orgId] });
    expect(approve.status).toBe(200);
    expect(approve.body.request.status).toBe("approved");
    expect(approve.body.user.email).toBe("jordan@example.com");
    expect(approve.body.user.role).toBe("editor");
    expect(approve.body.magicLinkSent).toBe(false);
    expect(typeof approve.body.temporaryPassword).toBe("string");

    // approving again (already decided) is a conflict
    const approveAgain = await ownerAgent
      .post(`/api/users/access-requests/${created.body.id}/approve`)
      .send({ role: "editor", orgIds: [ctx.orgId] });
    expect(approveAgain.status).toBe(409);
  });

  it("409s an access request for an email that already has an account", async () => {
    const res = await request(ctx.app).post("/api/auth/access-requests").send({
      name: "Owner Person",
      email: ctx.owner!.email,
    });
    expect(res.status).toBe(409);
  });

  it("declines a request", async () => {
    const created = await request(ctx.app).post("/api/auth/access-requests").send({
      name: "Nope Person",
      email: "nope@example.com",
    });
    expect(created.status).toBe(201);

    const ownerAgent = request.agent(ctx.app);
    await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });

    const decline = await ownerAgent.post(`/api/users/access-requests/${created.body.id}/decline`);
    expect(decline.status).toBe(200);
    expect(decline.body.status).toBe("declined");

    // a new request for the same (now-declined) email is allowed again
    const again = await request(ctx.app).post("/api/auth/access-requests").send({
      name: "Nope Person",
      email: "nope@example.com",
    });
    expect(again.status).toBe(201);
  });

  it("requires admin+ to list/approve/decline", async () => {
    const created = await request(ctx.app).post("/api/auth/access-requests").send({
      name: "Someone",
      email: "someone@example.com",
    });

    const ownerAgent = request.agent(ctx.app);
    await ownerAgent.post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
    await ownerAgent.post("/api/users").send({ email: "editor2@test.local", name: "Editor", role: "editor", orgIds: "*", password: "password123" });

    const editorAgent = request.agent(ctx.app);
    await editorAgent.post("/api/auth/login").send({ email: "editor2@test.local", password: "password123" });

    const list = await editorAgent.get("/api/users/access-requests");
    expect(list.status).toBe(403);
    const approve = await editorAgent.post(`/api/users/access-requests/${created.body.id}/approve`).send({});
    expect(approve.status).toBe(403);
  });

  it("rate limits access request creation per IP", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(ctx.app)
        .post("/api/auth/access-requests")
        .send({ name: `Person ${i}`, email: `person${i}@example.com` });
      expect(res.status).toBe(201);
    }
    const sixth = await request(ctx.app).post("/api/auth/access-requests").send({ name: "Overflow", email: "overflow@example.com" });
    expect(sixth.status).toBe(429);
  });
});
