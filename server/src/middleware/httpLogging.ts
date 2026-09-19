import type { NextFunction, Request, Response } from "express";
import { log } from "../services/logger";

const SKIP_PATHS = new Set(["/api/health", "/api/logs/stream"]);

/** Logs every request once it finishes: method, path, status, duration, and the acting user/org if known. */
export function httpLogging() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SKIP_PATHS.has(req.path) || req.path.startsWith("/uploads")) {
      next();
      return;
    }
    // Captured up front: nested routers temporarily rewrite req.url/req.path while dispatching, so
    // reading it inside the "finish" callback below can see a shortened, mount-relative path.
    const fullPath = req.originalUrl.split("?")[0];
    const start = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - start;
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      log[level]("http", `${req.method} ${fullPath} ${res.statusCode} ${durationMs}ms`, {
        userId: req.user?.id ?? null,
        orgId: req.org?.id ?? null,
        data: { method: req.method, path: fullPath, status: res.statusCode, durationMs },
      });
    });
    next();
  };
}
