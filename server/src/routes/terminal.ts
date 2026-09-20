import os from "node:os";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Socket } from "node:net";
import { Router } from "express";
import { WebSocketServer, type WebSocket } from "ws";
import type { TerminalClientMessage, TerminalServerMessage, User } from "@socmedia/shared";
import type { Db } from "../db/database";
import { resolveSessionUser } from "../middleware/auth";
import { createTerminalSession, terminalEnabled, terminalStatus } from "../services/terminal";
import { log } from "../services/logger";
import { asyncHandler } from "../utils/asyncHandler";

/** `GET /api/terminal/status` (signed-in, any role): whether the OS terminal is usable and, if not, why. */
export function terminalRouter(_db: Db): Router {
  const router = Router();

  router.get(
    "/status",
    asyncHandler(async (req, res) => {
      res.json(await terminalStatus(req.user!));
    })
  );

  return router;
}

const TERMINAL_WS_PATH = "/api/terminal";

function writeAndDestroy(socket: Socket, status: number, statusText: string): void {
  socket.write(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function send(ws: WebSocket, message: TerminalServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

async function handleTerminalConnection(ws: WebSocket, user: User, cols: number, rows: number): Promise<void> {
  const status = await terminalStatus(user);
  const hostname = os.hostname();

  const result = await createTerminalSession({
    userId: user.id,
    cols,
    rows,
    onOutput: (data) => send(ws, { type: "output", data }),
    onExit: (code) => {
      send(ws, { type: "exit", code });
      ws.close();
    },
  });

  if (!result.ok) {
    send(ws, { type: "error", message: result.reason });
    ws.close();
    return;
  }

  const { session } = result;
  // Never log the command stream itself, only that a session opened/closed.
  log.info("system", "Terminal session started", { userId: user.id, data: { hostname, sessionId: session.id } });

  // Report the pty state of this actual session (the status probe can only guess before a fork is attempted).
  send(ws, { type: "ready", status: { ...status, pty: session.pty }, cols, rows });

  ws.on("message", (raw) => {
    let message: TerminalClientMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    if (message.type === "input" && typeof message.data === "string") {
      session.write(message.data);
    } else if (message.type === "resize" && typeof message.cols === "number" && typeof message.rows === "number") {
      session.resize(message.cols, message.rows);
    } else if (message.type === "ping") {
      send(ws, { type: "pong" });
    }
  });

  const endSession = () => {
    session.kill();
    log.info("system", "Terminal session ended", { userId: user.id, data: { hostname, sessionId: session.id } });
  };
  ws.on("close", endSession);
  ws.on("error", endSession);
}

/**
 * Attaches the `/api/terminal` WebSocket endpoint to an already-created `http.Server`. Must be called
 * instead of (in addition to) `app.listen`, since Express alone cannot handle protocol upgrades; see
 * server/src/index.ts. Authenticates from the `suprstar_session` cookie using the same session lookup
 * as the HTTP middleware, and rejects the handshake outright (no WebSocket frames) when the caller is
 * signed out or not allowed to use the terminal.
 */
export function attachTerminalServer(httpServer: HttpServer, db: Db): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "", "http://internal");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== TERMINAL_WS_PATH) return;

    const user = resolveSessionUser(db, req.headers.cookie);
    if (!user) {
      writeAndDestroy(socket, 401, "Unauthorized");
      return;
    }
    if (!terminalEnabled(user)) {
      writeAndDestroy(socket, 403, "Forbidden");
      return;
    }

    const cols = Number(url.searchParams.get("cols"));
    const rows = Number(url.searchParams.get("rows"));

    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleTerminalConnection(ws, user, Number.isFinite(cols) && cols > 0 ? cols : 80, Number.isFinite(rows) && rows > 0 ? rows : 24);
    });
  });

  return wss;
}
