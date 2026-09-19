import { Router } from "express";
import { changePasswordSchema, loginSchema, setupSchema } from "@socmedia/shared";
import { nanoid } from "nanoid";
import type { Db } from "../db/database";
import { UsersRepo } from "../db/repositories/users";
import { requireAuth } from "../middleware/auth";
import { BadRequestError, ConflictError } from "../middleware/errors";
import { clearSessionCookie, hashPassword, parseCookies, signIn, signOut, verifyPassword, SESSION_COOKIE_NAME } from "../services/auth";
import { asyncHandler } from "../utils/asyncHandler";

/** Not org-scoped: authentication and the current user's own account. */
export function authRouter(db: Db): Router {
  const router = Router();
  const usersRepo = new UsersRepo(db);

  router.get(
    "/status",
    asyncHandler(async (req, res) => {
      res.json({ needsSetup: usersRepo.count() === 0, authenticated: !!req.user });
    })
  );

  router.post(
    "/setup",
    asyncHandler(async (req, res) => {
      if (usersRepo.count() > 0) throw new ConflictError("Setup has already been completed");
      const input = setupSchema.parse(req.body);
      const now = new Date().toISOString();
      const created = usersRepo.create({
        id: nanoid(),
        email: input.email,
        name: input.name,
        role: "owner",
        orgIds: "*",
        passwordHash: hashPassword(input.password),
        active: true,
        mustChangePassword: false,
        createdAt: now,
        lastLoginAt: now,
      });
      signIn(res, db, created.id);
      res.status(201).json({ authenticated: true, needsSetup: false, user: created });
    })
  );

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      const input = loginSchema.parse(req.body);
      const record = usersRepo.getByEmail(input.email);
      if (!record || !record.active || !verifyPassword(input.password, record.passwordHash)) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      const now = new Date().toISOString();
      usersRepo.touchLogin(record.id, now);
      signIn(res, db, record.id);
      const user = usersRepo.get(record.id)!;
      res.json({ authenticated: true, needsSetup: false, user });
    })
  );

  router.post(
    "/logout",
    requireAuth,
    asyncHandler(async (req, res) => {
      const cookies = parseCookies(req.headers.cookie);
      signOut(db, cookies[SESSION_COOKIE_NAME]);
      clearSessionCookie(res);
      res.status(204).end();
    })
  );

  router.get(
    "/me",
    asyncHandler(async (req, res) => {
      res.json({ authenticated: !!req.user, needsSetup: usersRepo.count() === 0, user: req.user ?? null });
    })
  );

  router.post(
    "/password",
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = changePasswordSchema.parse(req.body);
      const record = usersRepo.getRecord(req.user!.id)!;
      if (!verifyPassword(input.currentPassword, record.passwordHash)) {
        throw new BadRequestError("Current password is incorrect");
      }
      usersRepo.update(record.id, { passwordHash: hashPassword(input.newPassword), mustChangePassword: false });
      res.status(204).end();
    })
  );

  return router;
}
