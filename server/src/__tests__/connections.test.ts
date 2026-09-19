import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectionsRepo } from "../db/repositories/connections";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

describe("connections", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  function tiktokId(list: any[]): string {
    return list.find((c) => c.platform === "tiktok").id;
  }

  it("lists connections with secrets masked", async () => {
    const list = await request(ctx.app).get("/api/connections").set("X-Org-Id", ctx.orgId);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(4);
    for (const conn of list.body) {
      expect(conn.credentials.clientSecret).toBe("");
      expect(conn.credentials.accessToken).toBe("");
    }
  });

  it("round-trips credentials via PATCH, ignoring masked placeholder values", async () => {
    const list = (await request(ctx.app).get("/api/connections").set("X-Org-Id", ctx.orgId)).body;
    const id = tiktokId(list);

    const patch1 = await request(ctx.app)
      .patch(`/api/connections/${id}`)
      .set("X-Org-Id", ctx.orgId)
      .send({ credentials: { clientId: "real-client-id", clientSecret: "super-secret-value-1", redirectUri: "https://example.com/cb" } });
    expect(patch1.status).toBe(200);
    expect(patch1.body.credentials.clientId).toBe("real-client-id");
    expect(patch1.body.credentials.clientSecret).toMatch(/^••••/);

    const maskedSecret = patch1.body.credentials.clientSecret;
    const patch2 = await request(ctx.app)
      .patch(`/api/connections/${id}`)
      .set("X-Org-Id", ctx.orgId)
      .send({ displayName: "New Display Name", credentials: { clientSecret: maskedSecret } });
    expect(patch2.status).toBe(200);
    expect(patch2.body.displayName).toBe("New Display Name");

    const repo = new ConnectionsRepo(ctx.db);
    const stored = repo.get(id)!;
    expect(stored.credentials.clientSecret).toBe("super-secret-value-1");
  });

  it("test endpoint reports failure without credentials, success once connected (sandbox)", async () => {
    const list = (await request(ctx.app).get("/api/connections").set("X-Org-Id", ctx.orgId)).body;
    const id = tiktokId(list);

    const failing = await request(ctx.app).post(`/api/connections/${id}/test`).set("X-Org-Id", ctx.orgId);
    expect(failing.status).toBe(200);
    expect(failing.body.ok).toBe(false);
    expect(failing.body.details.length).toBeGreaterThanOrEqual(3);

    await request(ctx.app)
      .patch(`/api/connections/${id}`)
      .set("X-Org-Id", ctx.orgId)
      .send({ credentials: { clientId: "id", clientSecret: "secret", redirectUri: "https://example.com/cb" } });
    const connectRes = await request(ctx.app).post(`/api/connections/${id}/connect`).set("X-Org-Id", ctx.orgId);
    expect(connectRes.status).toBe(200);
    expect(connectRes.body.sandbox).toBe(true);
    expect(connectRes.body.connection.status).toBe("connected");

    const passing = await request(ctx.app).post(`/api/connections/${id}/test`).set("X-Org-Id", ctx.orgId);
    expect(passing.status).toBe(200);
    expect(passing.body.ok).toBe(true);
  });

  it("connect immediately marks the connection connected in sandbox mode with a fake profile", async () => {
    const list = (await request(ctx.app).get("/api/connections").set("X-Org-Id", ctx.orgId)).body;
    const id = tiktokId(list);

    const res = await request(ctx.app).post(`/api/connections/${id}/connect`).set("X-Org-Id", ctx.orgId);
    expect(res.status).toBe(200);
    expect(res.body.authorizeUrl).toContain("tiktok.com");
    expect(res.body.state).toBeTruthy();
    expect(res.body.connection.followers).toBeGreaterThan(0);
    expect(res.body.connection.handle).toBeTruthy();
  });

  it("disconnect clears tokens and resets status", async () => {
    const list = (await request(ctx.app).get("/api/connections").set("X-Org-Id", ctx.orgId)).body;
    const id = tiktokId(list);
    await request(ctx.app).post(`/api/connections/${id}/connect`).set("X-Org-Id", ctx.orgId);

    const res = await request(ctx.app).post(`/api/connections/${id}/disconnect`).set("X-Org-Id", ctx.orgId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("disconnected");
    expect(res.body.credentials.accessToken).toBe("");

    const repo = new ConnectionsRepo(ctx.db);
    const stored = repo.get(id)!;
    expect(stored.credentials.accessToken).toBeFalsy();
  });
});
