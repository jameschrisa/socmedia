import { Router } from "express";
import { z } from "zod";
import { accessRequestApproveSchema, userCreateSchema, userUpdateSchema } from "@socmedia/shared";
import { nanoid } from "nanoid";
import { config } from "../config";
import type { Db } from "../db/database";
import { AccessRequestsRepo } from "../db/repositories/accessRequests";
import { SessionsRepo } from "../db/repositories/sessions";
import type { UpdateUserPatch } from "../db/repositories/users";
import { UsersRepo } from "../db/repositories/users";
import { requireRole } from "../middleware/auth";
import { isRootAdmin } from "../services/rootAdmins";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../middleware/errors";
import { generateTemporaryPassword, hashPassword } from "../services/auth";
import { createMagicLinkToken } from "../services/magicLink";
import { mailerStatus, sendMail } from "../services/mailer";
import { log } from "../services/logger";
import { asyncHandler } from "../utils/asyncHandler";

const accessRequestListQuerySchema = z.object({ status: z.enum(["pending", "approved", "declined"]).optional() });

/** Admin+ only user management (not org-scoped: owners/admins manage every org's roster). */
export function usersRouter(db: Db): Router {
  const router = Router();
  router.use(requireRole("admin"));

  const usersRepo = new UsersRepo(db);
  const sessionsRepo = new SessionsRepo(db);
  const accessRequestsRepo = new AccessRequestsRepo(db);

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      res.json(usersRepo.list());
    })
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const input = userCreateSchema.parse(req.body);
      if (usersRepo.getByEmail(input.email)) throw new ConflictError(`A user with email "${input.email}" already exists`);
      if (input.role === "owner" && req.user!.role !== "owner") {
        throw new ForbiddenError("Only an owner can create another owner");
      }
      const now = new Date().toISOString();
      const created = usersRepo.create({
        id: nanoid(),
        email: input.email,
        name: input.name,
        role: input.role,
        orgIds: input.orgIds,
        passwordHash: hashPassword(input.password),
        active: true,
        mustChangePassword: true,
        createdAt: now,
        lastLoginAt: null,
      });
      log.info("auth", `User invited: ${created.email}`, { userId: req.user!.id, data: { invitedUserId: created.id, role: created.role } });
      res.status(201).json(created);
    })
  );

  /* ---------------------------------------------------------------------- */
  /* Access requests (registered before /:id so "access-requests" is never  */
  /* swallowed by the :id param route).                                     */
  /* ---------------------------------------------------------------------- */

  router.get(
    "/access-requests",
    asyncHandler(async (req, res) => {
      const { status } = accessRequestListQuerySchema.parse(req.query);
      res.json(accessRequestsRepo.list(status));
    })
  );

  router.post(
    "/access-requests/:id/approve",
    asyncHandler(async (req, res) => {
      const existing = accessRequestsRepo.get(req.params.id);
      if (!existing) throw new NotFoundError(`Access request ${req.params.id} not found`);
      if (existing.status !== "pending") throw new ConflictError("This request has already been decided");
      const input = accessRequestApproveSchema.parse(req.body);
      if (usersRepo.getByEmail(existing.email)) {
        throw new ConflictError(`A user with email "${existing.email}" already exists`);
      }

      const now = new Date().toISOString();
      const temporaryPassword = generateTemporaryPassword();
      const created = usersRepo.create({
        id: nanoid(),
        email: existing.email,
        name: existing.name,
        role: input.role,
        orgIds: input.orgIds,
        passwordHash: hashPassword(temporaryPassword),
        active: true,
        mustChangePassword: true,
        createdAt: now,
        lastLoginAt: null,
      });

      const decided = accessRequestsRepo.decide(existing.id, "approved", req.user!.id, now)!;
      log.info("auth", `Access request approved: ${existing.email}`, {
        userId: req.user!.id,
        data: { requestId: existing.id, newUserId: created.id, role: created.role },
      });

      let magicLinkSent = false;
      let responseTemporaryPassword: string | undefined = temporaryPassword;
      if (mailerStatus().configured) {
        const { secret } = createMagicLinkToken(db, existing.email);
        const link = `${config.clientUrl}/api/auth/magic/verify?token=${encodeURIComponent(secret)}`;
        await sendMail({
          to: existing.email,
          subject: "Your suprstar access is ready",
          text: `Your request to join suprstar was approved. Use this link to sign in (it expires in 15 minutes):\n\n${link}`,
        });
        magicLinkSent = true;
        responseTemporaryPassword = undefined;
      }

      res.json({ request: decided, user: created, temporaryPassword: responseTemporaryPassword, magicLinkSent });
    })
  );

  router.post(
    "/access-requests/:id/decline",
    asyncHandler(async (req, res) => {
      const existing = accessRequestsRepo.get(req.params.id);
      if (!existing) throw new NotFoundError(`Access request ${req.params.id} not found`);
      if (existing.status !== "pending") throw new ConflictError("This request has already been decided");
      const now = new Date().toISOString();
      const decided = accessRequestsRepo.decide(existing.id, "declined", req.user!.id, now)!;
      log.info("auth", `Access request declined: ${existing.email}`, { userId: req.user!.id, data: { requestId: existing.id } });
      res.json(decided);
    })
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const existing = usersRepo.get(req.params.id);
      if (!existing) throw new NotFoundError(`User ${req.params.id} not found`);
      const input = userUpdateSchema.parse(req.body);
      const actor = req.user!;

      // A root administrator is defined by ROOT_ADMIN_EMAILS on the host, so no session can take
      // their rights away: not an admin's, and not another owner's. Renaming and a password reset
      // are still allowed, since neither changes what they can reach.
      if (isRootAdmin(existing.email)) {
        const strippingRole = input.role !== undefined && input.role !== "owner";
        const strippingOrgs = input.orgIds !== undefined && input.orgIds !== "*";
        const deactivating = input.active === false;
        if (strippingRole || strippingOrgs || deactivating) {
          throw new ForbiddenError(
            "This is a root administrator. Their access is set by ROOT_ADMIN_EMAILS on the server and cannot be changed from the app."
          );
        }
      }

      const demotingOwner = input.role !== undefined && input.role !== "owner" && existing.role === "owner";
      const deactivatingOwner = input.active === false && existing.role === "owner" && existing.active;
      if ((demotingOwner || deactivatingOwner) && actor.role !== "owner") {
        throw new ForbiddenError("Owners cannot be demoted or deactivated by an admin");
      }
      if (input.role === "owner" && existing.role !== "owner" && actor.role !== "owner") {
        throw new ForbiddenError("Only an owner can grant the owner role");
      }
      if ((demotingOwner || deactivatingOwner) && usersRepo.countActiveOwners(existing.id) === 0) {
        throw new ConflictError("Cannot remove the last active owner");
      }

      const patch: UpdateUserPatch = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.role !== undefined) patch.role = input.role;
      if (input.orgIds !== undefined) patch.orgIds = input.orgIds;
      if (input.active !== undefined) patch.active = input.active;
      if (input.password !== undefined) {
        patch.passwordHash = hashPassword(input.password);
        patch.mustChangePassword = true;
      }

      const updated = usersRepo.update(existing.id, patch);
      if (input.active === false || input.password !== undefined) {
        sessionsRepo.deleteByUser(existing.id);
      }
      log.info("auth", input.active === false ? `User deactivated: ${existing.email}` : `User updated: ${existing.email}`, {
        userId: actor.id,
        data: { targetUserId: existing.id },
      });
      res.json(updated);
    })
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const existing = usersRepo.get(req.params.id);
      if (!existing) throw new NotFoundError(`User ${req.params.id} not found`);
      const actor = req.user!;
      if (existing.id === actor.id) throw new BadRequestError("You cannot delete your own account");
      if (isRootAdmin(existing.email)) {
        throw new ForbiddenError(
          "This is a root administrator. Remove them from ROOT_ADMIN_EMAILS on the server before deleting the account."
        );
      }
      if (existing.role === "owner" && actor.role !== "owner") {
        throw new ForbiddenError("Owners cannot be deleted by an admin");
      }
      if (existing.role === "owner" && existing.active && usersRepo.countActiveOwners(existing.id) === 0) {
        throw new ConflictError("Cannot delete the last active owner");
      }
      usersRepo.delete(existing.id);
      sessionsRepo.deleteByUser(existing.id);
      res.status(204).end();
    })
  );

  return router;
}
