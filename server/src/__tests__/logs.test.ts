import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { UsersRepo } from "../db/repositories/users";
import { hashPassword } from "../services/auth";
import { log } from "../services/logger";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

describe("activity log", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  it("GET /api/logs returns recent entries, newest last, filterable by level/source/q", async () => {
    log.info("media", "unique-marker-one", { orgId: ctx.orgId });
    log.warn("scheduler", "unique-marker-two", { orgId: ctx.orgId });

    const res = await request(ctx.app).get("/api/logs?limit=2000");
    expect(res.status).toBe(200);
    const messages = res.body.entries.map((e: { message: string }) => e.message);
    expect(messages).toContain("unique-marker-one");
    expect(messages).toContain("unique-marker-two");
    // newest last: marker-two was logged after marker-one
    expect(messages.indexOf("unique-marker-two")).toBeGreaterThan(messages.indexOf("unique-marker-one"));

    const byLevel = await request(ctx.app).get("/api/logs?level=warn&limit=2000");
    expect(byLevel.body.entries.every((e: { level: string }) => e.level === "warn")).toBe(true);
    expect(byLevel.body.entries.map((e: { message: string }) => e.message)).toContain("unique-marker-two");

    const byQ = await request(ctx.app).get("/api/logs?q=unique-marker-one");
    expect(byQ.body.entries.map((e: { message: string }) => e.message)).toEqual(["unique-marker-one"]);
  });

  it("redacts fields that look like secrets", async () => {
    log.info("system", "credential-test", { orgId: ctx.orgId, data: { password: "hunter2", apiKey: "sk-123", nested: { refreshToken: "abc" }, safe: "ok" } });
    const res = await request(ctx.app).get("/api/logs?q=credential-test");
    const entry = res.body.entries[0];
    expect(entry.data.password).toBe("[redacted]");
    expect(entry.data.apiKey).toBe("[redacted]");
    expect(entry.data.nested.refreshToken).toBe("[redacted]");
    expect(entry.data.safe).toBe("ok");
  });

  it("non-admin users never see auth/system entries and only see org-scoped-or-null entries", async () => {
    log.info("auth", "secret-auth-event");
    log.info("system", "secret-system-event");
    log.info("media", "org-scoped-event", { orgId: ctx.orgId });
    log.info("media", "other-org-event", { orgId: "some-other-org" });
    log.info("media", "global-event", {});

    const usersRepo = new UsersRepo(ctx.db);
    const editor = usersRepo.create({
      id: nanoid(),
      email: "editor@test.local",
      name: "Editor",
      role: "editor",
      orgIds: [ctx.orgId],
      passwordHash: hashPassword("password123"),
      active: true,
      mustChangePassword: false,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    });

    ctx.disableAuthBypass();
    const agent = request.agent(ctx.app);
    const login = await agent.post("/api/auth/login").send({ email: editor.email, password: "password123" });
    expect(login.status).toBe(200);

    const res = await agent.get("/api/logs?limit=2000");
    expect(res.status).toBe(200);
    const messages = res.body.entries.map((e: { message: string }) => e.message);
    expect(messages).not.toContain("secret-auth-event");
    expect(messages).not.toContain("secret-system-event");
    expect(messages).not.toContain("other-org-event");
    expect(messages).toContain("org-scoped-event");
    expect(messages).toContain("global-event");
  });

  it("admins see everything including auth/system entries", async () => {
    log.info("auth", "admin-visible-auth-event");
    const res = await request(ctx.app).get("/api/logs?q=admin-visible-auth-event");
    expect(res.body.entries.map((e: { message: string }) => e.message)).toContain("admin-visible-auth-event");
  });

  it("GET /api/logs/files requires admin; non-admins get 403", async () => {
    const usersRepo = new UsersRepo(ctx.db);
    const viewer = usersRepo.create({
      id: nanoid(),
      email: "viewer@test.local",
      name: "Viewer",
      role: "viewer",
      orgIds: [ctx.orgId],
      passwordHash: hashPassword("password123"),
      active: true,
      mustChangePassword: false,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    });
    ctx.disableAuthBypass();
    const agent = request.agent(ctx.app);
    await agent.post("/api/auth/login").send({ email: viewer.email, password: "password123" });
    const res = await agent.get("/api/logs/files");
    expect(res.status).toBe(403);
  });

  it("GET /api/logs/files (admin) lists today's log file; /files/:name validates the name and returns tail lines", async () => {
    log.info("system", "file-backed-entry");

    const list = await request(ctx.app).get("/api/logs/files");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.files)).toBe(true);
    expect(list.body.files.length).toBeGreaterThan(0);
    const name = list.body.files[0].name;
    expect(name).toMatch(/^app-\d{4}-\d{2}-\d{2}\.log$/);

    const invalid = await request(ctx.app).get("/api/logs/files/not-a-log-file.txt");
    expect(invalid.status).toBe(400);

    const missing = await request(ctx.app).get("/api/logs/files/app-1999-01-01.log");
    expect(missing.status).toBe(404);

    const tail = await request(ctx.app).get(`/api/logs/files/${name}?tail=5`);
    expect(tail.status).toBe(200);
    expect(tail.body.name).toBe(name);
    expect(Array.isArray(tail.body.lines)).toBe(true);
    expect(tail.body.lines.length).toBeGreaterThan(0);
  });

  it("GET /api/logs/stream delivers newly logged entries as SSE", async () => {
    let captured = "";
    await new Promise<void>((resolve) => {
      const req = request(ctx.app).get("/api/logs/stream");
      req.buffer(true).parse((res, callback) => {
        res.on("data", (chunk: Buffer) => {
          captured += chunk.toString("utf8");
          if (captured.includes("event: log")) res.destroy();
        });
        res.on("close", () => callback(null, null));
        res.on("end", () => callback(null, null));
      });
      req.end(() => resolve());
      setTimeout(() => log.info("media", "sse-marker-entry", { orgId: ctx.orgId }), 50);
    });

    expect(captured).toContain("event: log");
    expect(captured).toContain("sse-marker-entry");
  });
});
