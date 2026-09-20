import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import type { TerminalServerMessage } from "@socmedia/shared";
import { UsersRepo } from "../db/repositories/users";
import { attachTerminalServer } from "../routes/terminal";
import { hashPassword } from "../services/auth";
import { _resetTerminalSessionsForTests, terminalSessionCounts } from "../services/terminal";
import { cleanupTestContext, createTestContext, TEST_OWNER_PASSWORD, type TestContext } from "./testApp";

/** Starts a real http.Server (wrapping the test app) with the terminal WebSocket endpoint attached. */
async function startServer(ctx: TestContext): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(ctx.app);
  attachTerminalServer(server, ctx.db);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, port };
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Logs in as the seeded owner via a real request and returns the raw `suprstar_session=...` cookie pair. */
async function ownerCookie(ctx: TestContext): Promise<string> {
  ctx.disableAuthBypass();
  const res = await request(ctx.app).post("/api/auth/login").send({ email: ctx.owner!.email, password: TEST_OWNER_PASSWORD });
  expect(res.status).toBe(200);
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return setCookie[0].split(";")[0];
}

function waitForMessage(ws: WebSocket, predicate: (msg: TerminalServerMessage) => boolean, timeoutMs = 10000): Promise<TerminalServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for terminal message")), timeoutMs);
    const onMessage = (raw: Buffer | string) => {
      let msg: TerminalServerMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(msg);
      }
    };
    ws.on("message", onMessage);
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("OS terminal", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    _resetTerminalSessionsForTests();
    cleanupTestContext(ctx);
  });

  describe("GET /api/terminal/status", () => {
    it("401s when signed out", async () => {
      ctx.disableAuthBypass();
      const res = await request(ctx.app).get("/api/terminal/status");
      expect(res.status).toBe(401);
    });

    it("is disabled with a reason for an editor", async () => {
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

      const res = await agent.get("/api/terminal/status");
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      expect(res.body.reason).toMatch(/owner|admin/i);
    });

    it("is enabled for the owner in the test environment", async () => {
      const res = await request(ctx.app).get("/api/terminal/status");
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.reason ?? null).toBeNull();
      expect(typeof res.body.shell).toBe("string");
      expect(typeof res.body.hostname).toBe("string");
      expect(typeof res.body.cwd).toBe("string");
    });
  });

  describe("WebSocket /api/terminal", () => {
    it("rejects the handshake with 401 when there is no session cookie", async () => {
      const { server, port } = await startServer(ctx);
      try {
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/api/terminal`);
          ws.on("unexpected-response", (_req, res) => {
            try {
              expect(res.statusCode).toBe(401);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
          ws.on("open", () => reject(new Error("handshake should not succeed without a cookie")));
          ws.on("error", () => {
            // 'unexpected-response' already asserts the status; a socket-level error can follow it.
          });
        });
      } finally {
        await stopServer(server);
      }
    });

    it("sends ready, echoes shell output, then exits and frees the slot on close", async () => {
      const { server, port } = await startServer(ctx);
      try {
        const cookie = await ownerCookie(ctx);
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/terminal?cols=80&rows=24`, { headers: { Cookie: cookie } });

        const ready = await waitForMessage(ws, (m) => m.type === "ready");
        expect(ready.type).toBe("ready");
        if (ready.type === "ready") {
          expect(ready.status.enabled).toBe(true);
          expect(ready.cols).toBe(80);
          expect(ready.rows).toBe(24);
        }
        expect(terminalSessionCounts(ctx.owner!.id).forUser).toBe(1);

        const outputPromise = waitForMessage(ws, (m) => m.type === "output" && m.data.includes("suprstar-ok"));
        const command = process.platform === "win32" ? "echo suprstar-ok\r\n" : "echo suprstar-ok\n";
        ws.send(JSON.stringify({ type: "input", data: command }));
        await outputPromise;

        await new Promise<void>((resolve) => {
          ws.once("close", () => resolve());
          ws.close();
        });
        // Give the process-exit handler a tick to untrack the session.
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(terminalSessionCounts(ctx.owner!.id).forUser).toBe(0);
      } finally {
        await stopServer(server);
      }
    }, 15000);

    it("caps concurrent sessions per user and reports an error on the 4th", async () => {
      const { server, port } = await startServer(ctx);
      try {
        const cookie = await ownerCookie(ctx);
        const open = () => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/api/terminal`, { headers: { Cookie: cookie } });
          return { ws, ready: waitForMessage(ws, (m) => m.type === "ready") };
        };

        const first = open();
        const second = open();
        const third = open();
        await Promise.all([first.ready, second.ready, third.ready]);
        expect(terminalSessionCounts(ctx.owner!.id).forUser).toBe(3);

        const fourth = new WebSocket(`ws://127.0.0.1:${port}/api/terminal`, { headers: { Cookie: cookie } });
        const errorMsg = await waitForMessage(fourth, (m) => m.type === "error");
        expect(errorMsg.type).toBe("error");
        if (errorMsg.type === "error") {
          expect(errorMsg.message).toMatch(/3 terminal sessions|already have/i);
        }

        first.ws.close();
        second.ws.close();
        third.ws.close();
      } finally {
        await stopServer(server);
      }
    }, 15000);
  });
});
