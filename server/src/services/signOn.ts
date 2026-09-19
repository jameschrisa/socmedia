import crypto from "node:crypto";
import { nanoid } from "nanoid";
import type { User } from "@socmedia/shared";
import type { Db } from "../db/database";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { UsersRepo } from "../db/repositories/users";
import { hashPassword } from "./auth";
import { getAccessPolicy, findAllowedDomain } from "./accessPolicy";
import { log } from "./logger";

export type SignOnDenyReason = "domain" | "inactive";

export interface SignOnAllowed {
  ok: true;
  user: User;
  /** True when this call just created the user (domain auto-provisioning). */
  provisioned: boolean;
}

export interface SignOnDenied {
  ok: false;
  reason: SignOnDenyReason;
}

export type SignOnResult = SignOnAllowed | SignOnDenied;

/** Resolves `orgSlugs` ("*" stays "*"; slugs that no longer exist are silently dropped). */
function resolveOrgIdsFromSlugs(db: Db, orgSlugs: string[] | "*"): string[] | "*" {
  if (orgSlugs === "*") return "*";
  const repo = new OrganizationsRepo(db);
  const ids: string[] = [];
  for (const slug of orgSlugs) {
    const org = slug === "*" ? undefined : repo.getBySlug(slug);
    if (org) ids.push(org.id);
  }
  return ids;
}

/**
 * Decides whether `email` may self-serve sign in (magic link or Google) and loads/provisions the
 * user. Business rule: allowed when (a) an active user with that email already exists and the
 * policy allows invited users from any domain, or the user's domain is itself allowed, or (b) the
 * email's domain is in the access policy, in which case a user is auto-provisioned with that
 * domain's role and org ids. Deactivated users are always denied.
 */
/** Same rules as resolveSignOnUser, without provisioning anything: used to refuse a magic-link request up front. */
export function checkSignOnAllowed(db: Db, rawEmail: string): { ok: true } | SignOnDenied {
  const email = rawEmail.trim().toLowerCase();
  const policy = getAccessPolicy(db);
  const allowedDomain = findAllowedDomain(policy, email);
  const existing = new UsersRepo(db).getByEmail(email);
  if (existing) {
    if (!existing.active) return { ok: false, reason: "inactive" };
    return policy.allowInvitedUsersAnyDomain || allowedDomain ? { ok: true } : { ok: false, reason: "domain" };
  }
  return allowedDomain ? { ok: true } : { ok: false, reason: "domain" };
}

export function resolveSignOnUser(db: Db, rawEmail: string): SignOnResult {
  const email = rawEmail.trim().toLowerCase();
  const usersRepo = new UsersRepo(db);
  const policy = getAccessPolicy(db);
  const allowedDomain = findAllowedDomain(policy, email);
  const existing = usersRepo.getByEmail(email);

  if (existing) {
    if (!existing.active) return { ok: false, reason: "inactive" };
    if (policy.allowInvitedUsersAnyDomain || allowedDomain) {
      return { ok: true, user: usersRepo.get(existing.id)!, provisioned: false };
    }
    return { ok: false, reason: "domain" };
  }

  if (!allowedDomain) return { ok: false, reason: "domain" };

  const now = new Date().toISOString();
  // A random, never-communicated password: this account only ever signs in via magic link/Google.
  const unusablePassword = crypto.randomBytes(32).toString("hex");
  const created = usersRepo.create({
    id: nanoid(),
    email,
    name: email.split("@")[0],
    role: allowedDomain.role,
    orgIds: resolveOrgIdsFromSlugs(db, allowedDomain.orgSlugs),
    passwordHash: hashPassword(unusablePassword),
    active: true,
    mustChangePassword: false,
    createdAt: now,
    lastLoginAt: null,
  });
  log.info("auth", `User auto-provisioned via self-serve sign-in: ${email}`, {
    userId: created.id,
    data: { email, role: created.role, domain: allowedDomain.domain },
  });
  return { ok: true, user: created, provisioned: true };
}
