import { Router } from "express";
import { userCreateSchema, userUpdateSchema } from "@socmedia/shared";
import { nanoid } from "nanoid";
import type { Db } from "../db/database";
import { SessionsRepo } from "../db/repositories/sessions";
import type { UpdateUserPatch } from "../db/repositories/users";
import { UsersRepo } from "../db/repositories/users";
import { requireRole } from "../middleware/auth";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../middleware/errors";
import { hashPassword } from "../services/auth";
import { log } from "../services/logger";
import { asyncHandler } from "../utils/asyncHandler";

/** Admin+ only user management (not org-scoped: owners/admins manage every org's roster). */
export function usersRouter(db: Db): Router {
  const router = Router();
  router.use(requireRole("admin"));

  const usersRepo = new UsersRepo(db);
  const sessionsRepo = new SessionsRepo(db);

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

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const existing = usersRepo.get(req.params.id);
      if (!existing) throw new NotFoundError(`User ${req.params.id} not found`);
      const input = userUpdateSchema.parse(req.body);
      const actor = req.user!;

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
