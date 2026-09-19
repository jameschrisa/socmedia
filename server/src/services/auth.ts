import crypto from "node:crypto";
import type { Response } from "express";
import { nanoid } from "nanoid";
import type { User } from "@socmedia/shared";
import { config } from "../config";
import type { Db } from "../db/database";
import { SessionsRepo } from "../db/repositories/sessions";
import { UsersRepo } from "../db/repositories/users";

/** Cookie carrying the (signed) session id. */
export const SESSION_COOKIE_NAME = "suprstar_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SCRYPT_KEYLEN = 64;

/* ---------------------------------------------------------------------- */
/* Passwords                                                              */
/* ---------------------------------------------------------------------- */

/** Hashes a password with scrypt and a per-user random salt. Format: "scrypt:<saltHex>:<hashHex>". */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

/** Verifies a password against a stored hash using a constant-time comparison. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const candidate = crypto.scryptSync(password, salt, expected.length);
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------- */
/* Cookie signing (HMAC-SHA256 over the session id, no external deps)     */
/* ---------------------------------------------------------------------- */

function sign(id: string): string {
  const sig = crypto.createHmac("sha256", config.secretKey).update(id).digest("base64url");
  return `${id}.${sig}`;
}

function unsign(value: string): string | null {
  const idx = value.lastIndexOf(".");
  if (idx === -1) return null;
  const id = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  const expected = crypto.createHmac("sha256", config.secretKey).update(id).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

/** Parses a raw `Cookie` request header into a key/value map (no external deps). */
export function parseCookies(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: config.nodeEnv === "production",
    maxAge: SESSION_TTL_MS,
  };
}

/* ---------------------------------------------------------------------- */
/* Sessions                                                                */
/* ---------------------------------------------------------------------- */

function createSessionForUser(db: Db, userId: string): { id: string; expiresAt: string } {
  const sessions = new SessionsRepo(db);
  const id = nanoid();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  sessions.create({ id, userId, expiresAt, createdAt: now.toISOString() });
  return { id, expiresAt };
}

/** Creates a session for `userId` and sets the signed cookie on the response. */
export function signIn(res: Response, db: Db, userId: string): void {
  const { id } = createSessionForUser(db, userId);
  res.cookie(SESSION_COOKIE_NAME, sign(id), sessionCookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

/** Ends the session behind a raw (signed) cookie value, if any. Used by logout. */
export function signOut(db: Db, rawCookieValue: string | undefined): void {
  if (!rawCookieValue) return;
  const id = unsign(rawCookieValue);
  if (!id) return;
  new SessionsRepo(db).delete(id);
}

/** Resolves the signed-in user from a raw (signed) cookie value, lazily cleaning up expired sessions. */
export function resolveUserFromCookie(db: Db, rawCookieValue: string | undefined): User | undefined {
  if (!rawCookieValue) return undefined;
  const id = unsign(rawCookieValue);
  if (!id) return undefined;
  const sessions = new SessionsRepo(db);
  sessions.deleteExpired();
  const session = sessions.get(id);
  if (!session) return undefined;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    sessions.delete(id);
    return undefined;
  }
  const user = new UsersRepo(db).get(session.userId);
  if (!user || !user.active) return undefined;
  return user;
}

/* ---------------------------------------------------------------------- */
/* Bootstrap                                                               */
/* ---------------------------------------------------------------------- */

/** Creates the first owner from ADMIN_EMAIL/ADMIN_PASSWORD (+ADMIN_NAME) when no users exist yet. */
export function ensureBootstrapAdmin(db: Db): void {
  const usersRepo = new UsersRepo(db);
  if (usersRepo.count() > 0) return;
  if (!config.adminEmail || !config.adminPassword) return;
  const now = new Date().toISOString();
  usersRepo.create({
    id: nanoid(),
    email: config.adminEmail,
    name: config.adminName || "Owner",
    role: "owner",
    orgIds: "*",
    passwordHash: hashPassword(config.adminPassword),
    active: true,
    mustChangePassword: false,
    createdAt: now,
    lastLoginAt: null,
  });
}
