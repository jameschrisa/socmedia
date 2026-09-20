import type { NextFunction, Request, Response } from "express";
import type { User, UserRole } from "@socmedia/shared";
import { config } from "../config";
import type { Db } from "../db/database";
import { UsersRepo } from "../db/repositories/users";
import { parseCookies, resolveUserFromCookie, SESSION_COOKIE_NAME } from "../services/auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const ROLE_ORDER: Record<UserRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

/**
 * Parses the session cookie and attaches the signed-in user to `req.user`.
 * In tests (config.isTest), when no cookie is present at all and `config.testAuthUserId` is set,
 * requests are treated as that user so existing tests can drive the API without a real login flow.
 */
export function attachUser(db: Db) {
  const usersRepo = new UsersRepo(db);
  return (req: Request, _res: Response, next: NextFunction) => {
    const cookies = parseCookies(req.headers.cookie);
    const raw = cookies[SESSION_COOKIE_NAME];
    if (raw) {
      const user = resolveUserFromCookie(db, raw);
      if (user) req.user = user;
      next();
      return;
    }
    if (config.isTest && config.testAuthUserId) {
      const user = usersRepo.get(config.testAuthUserId);
      if (user) req.user = user;
    }
    next();
  };
}

/** Resolves the signed-in user from a raw `Cookie` request header. Used outside Express (e.g. the WebSocket upgrade handler). */
export function resolveSessionUser(db: Db, cookieHeader: string | undefined | null): User | undefined {
  const cookies = parseCookies(cookieHeader ?? undefined);
  return resolveUserFromCookie(db, cookies[SESSION_COOKIE_NAME]);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  next();
}

/** Requires the signed-in user's role to be at least `min` (viewer < editor < admin < owner). */
export function requireRole(min: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Sign in required" });
      return;
    }
    if (ROLE_ORDER[req.user.role] < ROLE_ORDER[min]) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Mutating (non-GET/HEAD/OPTIONS) requests require editor role or above. */
export function requireWrite(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  requireRole("editor")(req, res, next);
}

/** Paths that never require a signed-in user (see docs/API.md "Authentication & users"). */
const PUBLIC_GET_PATHS = new Set(["/api/health", "/api/auth/status", "/api/auth/me", "/api/connections/oauth/callback"]);
const PUBLIC_POST_PATHS = new Set(["/api/auth/setup", "/api/auth/login", "/api/auth/access-requests", "/api/inbound/twilio"]);

/**
 * Telegram's webhook path carries a per-install secret in the URL (`/api/inbound/telegram/:secret`);
 * the route itself checks the `X-Telegram-Bot-Api-Secret-Token` header and returns 403 on a mismatch.
 */
const INBOUND_TELEGRAM_PATH_RE = /^\/api\/inbound\/telegram\/[^/]+\/?$/;

/** Magic-link, Google and Entra SSO endpoints: by definition unauthenticated (they establish the session). */
const AUTH_SELF_SERVE_PATH_RE = /^\/api\/auth\/(magic|google|entra)\/[^/]+\/?$/;

/**
 * Quick-post-from-a-phone: the token secret in the URL *is* the credential, so `GET/POST
 * /api/quick/:token` are public. `/api/quick/tokens` and `/api/quick/tokens/:id` (link management)
 * are excluded and stay behind normal auth.
 */
const QUICK_PUBLIC_PATH_RE = /^\/api\/quick\/(?!tokens(?:\/|$))[^/]+\/?$/;

/** Global gate: lets public routes and /uploads through, requires a signed-in user for everything else under /api. */
export function authGate(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith("/uploads")) {
    next();
    return;
  }
  if (req.method === "GET" && PUBLIC_GET_PATHS.has(req.path)) {
    next();
    return;
  }
  if (req.method === "POST" && PUBLIC_POST_PATHS.has(req.path)) {
    next();
    return;
  }
  if ((req.method === "GET" || req.method === "POST") && QUICK_PUBLIC_PATH_RE.test(req.path)) {
    next();
    return;
  }
  if (req.method === "POST" && INBOUND_TELEGRAM_PATH_RE.test(req.path)) {
    next();
    return;
  }
  if ((req.method === "GET" || req.method === "POST") && AUTH_SELF_SERVE_PATH_RE.test(req.path)) {
    next();
    return;
  }
  requireAuth(req, res, next);
}

export { ROLE_ORDER };
