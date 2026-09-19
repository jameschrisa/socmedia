import crypto from "node:crypto";
import { nanoid } from "nanoid";
import type { Db } from "../db/database";
import { LoginTokensRepo } from "../db/repositories/loginTokens";

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_EMAIL = 5;
const MAX_PER_IP = 30;

const emailAttempts = new Map<string, number[]>();
const ipAttempts = new Map<string, number[]>();

function prune(arr: number[], now: number): number[] {
  return arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
}

/** True (and records the attempt) when both the email and the IP are still under their 15-minute caps. */
export function checkMagicLinkRateLimit(email: string, ip: string, now: number = Date.now()): boolean {
  const emailKey = email.trim().toLowerCase();
  const emailRecent = prune(emailAttempts.get(emailKey) ?? [], now);
  const ipRecent = prune(ipAttempts.get(ip) ?? [], now);
  if (emailRecent.length >= MAX_PER_EMAIL || ipRecent.length >= MAX_PER_IP) {
    emailAttempts.set(emailKey, emailRecent);
    ipAttempts.set(ip, ipRecent);
    return false;
  }
  emailRecent.push(now);
  ipRecent.push(now);
  emailAttempts.set(emailKey, emailRecent);
  ipAttempts.set(ip, ipRecent);
  return true;
}

/** Test-only: clears rate-limit state between test files. */
export function resetMagicLinkRateLimits(): void {
  emailAttempts.clear();
  ipAttempts.clear();
}

export function hashMagicLinkToken(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/** Creates a single-use, 15-minute magic-link token for `email` and returns the raw secret. */
export function createMagicLinkToken(db: Db, email: string): { secret: string; expiresAt: string } {
  const repo = new LoginTokensRepo(db);
  const secret = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS).toISOString();
  repo.create({
    id: nanoid(),
    email: email.trim().toLowerCase(),
    tokenHash: hashMagicLinkToken(secret),
    purpose: "magic",
    expiresAt,
    createdAt: now.toISOString(),
  });
  return { secret, expiresAt };
}

export type MagicLinkVerifyResult = { ok: true; email: string } | { ok: false; reason: "invalid" | "expired" };

/** Validates and consumes a magic-link token; a token can only ever succeed once. */
export function verifyMagicLinkToken(db: Db, rawToken: string): MagicLinkVerifyResult {
  const repo = new LoginTokensRepo(db);
  const record = repo.getByHash(hashMagicLinkToken(rawToken));
  if (!record || record.purpose !== "magic" || record.usedAt) return { ok: false, reason: "invalid" };
  if (new Date(record.expiresAt).getTime() <= Date.now()) return { ok: false, reason: "expired" };
  repo.markUsed(record.id, new Date().toISOString());
  return { ok: true, email: record.email };
}
