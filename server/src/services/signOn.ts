import crypto from "node:crypto";
import { nanoid } from "nanoid";
import type { User } from "@socmedia/shared";
import type { Db } from "../db/database";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { UsersRepo } from "../db/repositories/users";
import { hashPassword } from "./auth";
import { getAccessPolicy, findAllowedDomain } from "./accessPolicy";
import { log } from "./logger";
import { enforceRootAdmin, isRootAdmin } from "./rootAdmins";

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
  const root = isRootAdmin(email);
  const existing = new UsersRepo(db).getByEmail(email);
  if (existing) {
    // A root administrator is never locked out by a deactivation or a domain rule: those are the
    // in-app edits root exists to be immune to, and the account is repaired on sign-in.
    if (root) return { ok: true };
    if (!existing.active) return { ok: false, reason: "inactive" };
    return policy.allowInvitedUsersAnyDomain || allowedDomain ? { ok: true } : { ok: false, reason: "domain" };
  }
  return root || allowedDomain ? { ok: true } : { ok: false, reason: "domain" };
}

export function resolveSignOnUser(db: Db, rawEmail: string): SignOnResult {
  const email = rawEmail.trim().toLowerCase();
  const usersRepo = new UsersRepo(db);
  const policy = getAccessPolicy(db);
  const allowedDomain = findAllowedDomain(policy, email);
  const existing = usersRepo.getByEmail(email);

  if (existing) {
    if (isRootAdmin(email)) {
      return { ok: true, user: enforceRootAdmin(db, existing), provisioned: false };
    }
    if (!existing.active) return { ok: false, reason: "inactive" };
    if (policy.allowInvitedUsersAnyDomain || allowedDomain) {
      // An invited account carries a temporary password and a "must change it" flag. Proving who
      // you are through Microsoft, Google or an emailed link is at least as strong as knowing that
      // temporary password, so clear the flag rather than demanding a password the person may
      // never have been given.
      if (existing.mustChangePassword) {
        usersRepo.update(existing.id, { mustChangePassword: false });
        log.info("auth", `Cleared the pending password change for ${email} after a federated sign-in`, {
          userId: existing.id,
          data: { email },
        });
      }
      // A root administrator signs in with full rights even if the stored record drifted.
      return { ok: true, user: enforceRootAdmin(db, usersRepo.get(existing.id)!), provisioned: false };
    }
    return { ok: false, reason: "domain" };
  }

  const root = isRootAdmin(email);
  if (!allowedDomain && !root) return { ok: false, reason: "domain" };

  const now = new Date().toISOString();
  // A random, never-communicated password: this account only ever signs in via magic link/Google.
  const unusablePassword = crypto.randomBytes(32).toString("hex");
  const created = usersRepo.create({
    id: nanoid(),
    email,
    name: email.split("@")[0],
    // A root administrator is never held to a domain entry's role or org list.
    role: root ? "owner" : allowedDomain!.role,
    orgIds: root ? "*" : resolveOrgIdsFromSlugs(db, allowedDomain!.orgSlugs),
    passwordHash: hashPassword(unusablePassword),
    active: true,
    mustChangePassword: false,
    createdAt: now,
    lastLoginAt: null,
  });
  log.info("auth", `User auto-provisioned via self-serve sign-in: ${email}`, {
    userId: created.id,
    data: { email, role: created.role, domain: allowedDomain?.domain ?? null, rootAdmin: root },
  });
  return { ok: true, user: created, provisioned: true };
}
