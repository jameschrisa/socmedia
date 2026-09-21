import crypto from "node:crypto";
import { nanoid } from "nanoid";
import type { User } from "@socmedia/shared";
import { config } from "../config";
import type { Db } from "../db/database";
import { UsersRepo } from "../db/repositories/users";
import { hashPassword } from "./auth";
import { log } from "./logger";

/**
 * Root administrators are the accounts that own the whole installation: always `owner`, always
 * `orgIds: "*"`, always active, and out of reach of every in-app edit. They come from the
 * `ROOT_ADMIN_EMAILS` environment variable, so the list can only be changed by someone with
 * access to the host. Without that, a scoped account could be handed the keys from inside the
 * app, which is exactly what org isolation is supposed to prevent.
 *
 * Everyone else, including an account on an allowed sign-in domain, is confined to the
 * organizations their access-policy entry names (see services/accessPolicy.ts and
 * services/signOn.ts).
 */

export function rootAdminEmails(): string[] {
  return config.rootAdminEmails;
}

export function isRootAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return config.rootAdminEmails.includes(email.trim().toLowerCase());
}

/** The fields a root administrator must always have, whatever is currently stored. */
function rootAdminDrift(user: User): { role?: "owner"; orgIds?: "*"; active?: true; mustChangePassword?: false } {
  const patch: { role?: "owner"; orgIds?: "*"; active?: true; mustChangePassword?: false } = {};
  if (user.role !== "owner") patch.role = "owner";
  if (user.orgIds !== "*") patch.orgIds = "*";
  if (!user.active) patch.active = true;
  // Root administrators sign in through Microsoft, Google or a magic link, so an inherited
  // "must change it" flag would demand a password they were never given.
  if (user.mustChangePassword) patch.mustChangePassword = false;
  return patch;
}

/**
 * Brings `user` back to full root rights if it drifted, and returns the current record. A no-op
 * for everyone else, and a no-op for a root administrator that is already correct, so this is
 * safe to call on every sign-in.
 */
export function enforceRootAdmin(db: Db, user: User): User {
  if (!isRootAdmin(user.email)) return user;
  const patch = rootAdminDrift(user);
  if (Object.keys(patch).length === 0) return user;
  const usersRepo = new UsersRepo(db);
  usersRepo.update(user.id, patch);
  log.warn("auth", `Restored root administrator rights for ${user.email}`, {
    userId: user.id,
    data: { email: user.email, restored: Object.keys(patch) },
  });
  return usersRepo.get(user.id)!;
}

/**
 * Creates any root administrator that does not exist yet and repairs any that has drifted. Called
 * once at startup, so a restored backup or a hand-edited database converges on the configured
 * list rather than leaving the installation without an owner.
 *
 * A created account gets a random password that is never communicated: root administrators sign in
 * through Microsoft, Google or a magic link. An existing account keeps its password.
 */
export function ensureRootAdmins(db: Db): void {
  const emails = rootAdminEmails();
  if (emails.length === 0) return;
  const usersRepo = new UsersRepo(db);
  const now = new Date().toISOString();

  for (const email of emails) {
    const existing = usersRepo.getByEmail(email);
    if (existing) {
      const patch = rootAdminDrift(existing);
      if (Object.keys(patch).length > 0) {
        usersRepo.update(existing.id, patch);
        log.warn("auth", `Restored root administrator rights for ${email} at startup`, {
          userId: existing.id,
          data: { email, restored: Object.keys(patch) },
        });
      }
      continue;
    }
    const created = usersRepo.create({
      id: nanoid(),
      email,
      name: email.split("@")[0],
      role: "owner",
      orgIds: "*",
      passwordHash: hashPassword(crypto.randomBytes(32).toString("hex")),
      active: true,
      mustChangePassword: false,
      createdAt: now,
      lastLoginAt: null,
    });
    log.info("auth", `Root administrator provisioned: ${email}`, { userId: created.id, data: { email } });
  }
}
