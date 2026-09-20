import { Router } from "express";
import { logQuerySchema, type LogEntry, type LogLevel, type LogSource, type User } from "@socmedia/shared";
import type { Db } from "../db/database";
import { requireRole } from "../middleware/auth";
import { BadRequestError, NotFoundError } from "../middleware/errors";
import { log } from "../services/logger";
import { asyncHandler } from "../utils/asyncHandler";

const LOG_FILE_NAME_RE = /^app-\d{4}-\d{2}-\d{2}\.log$/;
const PING_INTERVAL_MS = 20_000;

/** Non-admins only see entries scoped to their orgs, and never auth/system-source entries. */
function visibleToUser(user: User, entry: LogEntry): boolean {
  if (user.role === "admin" || user.role === "owner") return true;
  if (entry.source === "auth" || entry.source === "system") return false;
  if (entry.orgId == null) return true;
  if (user.orgIds === "*") return true;
  return user.orgIds.includes(entry.orgId);
}

/** Signed-in-user activity log: recent entries, a live SSE stream, and access to the on-disk files (admin+). */
export function logsRouter(_db: Db): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const query = logQuerySchema.parse(req.query);
      const all = log.recent({ level: query.level, source: query.source, since: query.since, q: query.q, limit: 2000 });
      const visible = all.filter((e) => visibleToUser(req.user!, e));
      const entries = visible.slice(Math.max(0, visible.length - query.limit));
      res.json({ entries });
    })
  );

  router.get("/stream", (req, res) => {
    const user = req.user!;
    const levelFilter = typeof req.query.level === "string" ? (req.query.level as LogLevel) : undefined;
    const sourceFilter = typeof req.query.source === "string" ? (req.query.source as LogSource) : undefined;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    // First bytes right away: proxies forward the response and the browser fires EventSource "open".
    res.write(": connected\n\n");

    const send = (entry: LogEntry) => {
      if (levelFilter && entry.level !== levelFilter) return;
      if (sourceFilter && entry.source !== sourceFilter) return;
      if (!visibleToUser(user, entry)) return;
      res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
    };

    const unsubscribe = log.subscribe(send);
    const pingTimer = setInterval(() => {
      res.write(": ping\n\n");
    }, PING_INTERVAL_MS);

    req.on("close", () => {
      clearInterval(pingTimer);
      unsubscribe();
    });
  });

  router.get(
    "/files",
    requireRole("admin"),
    asyncHandler(async (_req, res) => {
      res.json({ files: log.listFiles() });
    })
  );

  router.get(
    "/files/:name",
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const { name } = req.params;
      if (!LOG_FILE_NAME_RE.test(name)) throw new BadRequestError("Invalid log file name");
      const tailRaw = req.query.tail;
      const tail = typeof tailRaw === "string" && Number.isFinite(Number(tailRaw)) ? Math.max(1, Math.min(10000, Number(tailRaw))) : 500;
      const result = log.readFileTail(name, tail);
      if (!result) throw new NotFoundError(`Log file ${name} not found`);
      res.json(result);
    })
  );

  return router;
}
