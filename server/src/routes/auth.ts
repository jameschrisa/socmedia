import { Router } from "express";
import { accessRequestCreateSchema, changePasswordSchema, loginSchema, magicLinkRequestSchema, setupSchema } from "@socmedia/shared";
import type { MagicLinkRequestResult } from "@socmedia/shared";
import { nanoid } from "nanoid";
import { config } from "../config";
import type { Db } from "../db/database";
import { AccessRequestsRepo } from "../db/repositories/accessRequests";
import { UsersRepo } from "../db/repositories/users";
import { requireAuth } from "../middleware/auth";
import { BadRequestError, ConflictError } from "../middleware/errors";
import { getAccessPolicy } from "../services/accessPolicy";
import { checkAccessRequestRateLimit } from "../services/accessRequests";
import {
  clearSessionCookie,
  hashPassword,
  parseCookies,
  signIn,
  signOut,
  verifyPassword,
  SESSION_COOKIE_NAME,
} from "../services/auth";
import {
  entraAuthorizeUrl,
  entraConfigured,
  entraStateCookieOptions,
  exchangeEntraCode,
  generateEntraState,
  nonceFromState,
  verifyEntraIdToken,
  ENTRA_STATE_COOKIE,
} from "../services/entraAuth";
import {
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  generateGoogleState,
  googleAuthorizeUrl,
  googleConfigured,
  googleStateCookieOptions,
  GOOGLE_STATE_COOKIE,
} from "../services/googleAuth";
import { log } from "../services/logger";
import { checkMagicLinkRateLimit, createMagicLinkToken, verifyMagicLinkToken } from "../services/magicLink";
import { magicLinkAvailable, mailerStatus, sendMail } from "../services/mailer";
import { enforceRootAdmin } from "../services/rootAdmins";
import { checkSignOnAllowed, resolveSignOnUser } from "../services/signOn";
import { asyncHandler } from "../utils/asyncHandler";

function clientIp(req: { ip?: string; socket: { remoteAddress?: string | null } }): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function magicLinkUrl(secret: string): string {
  return `${config.clientUrl}/api/auth/magic/verify?token=${encodeURIComponent(secret)}`;
}

function authRedirect(reason?: string): string {
  return reason ? `${config.clientUrl}/?auth=error&reason=${reason}` : `${config.clientUrl}/`;
}

/** Not org-scoped: authentication and the current user's own account. */
export function authRouter(db: Db): Router {
  const router = Router();
  const usersRepo = new UsersRepo(db);
  const accessRequestsRepo = new AccessRequestsRepo(db);

  // Shared by /status and /me (the client's persisted session query) so the sign-in page always
  // knows which methods are on offer, however it first loads.
  function signOnFields() {
    const policy = getAccessPolicy(db);
    return {
      providers: {
        password: true,
        magicLink: magicLinkAvailable(),
        google: googleConfigured(),
        entra: entraConfigured(),
      },
      allowedDomains: policy.domains.map((d) => d.domain),
    };
  }

  router.get(
    "/status",
    asyncHandler(async (req, res) => {
      res.json({
        needsSetup: usersRepo.count() === 0,
        authenticated: !!req.user,
        ...signOnFields(),
      });
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
      log.info("auth", `Setup: created first owner ${input.email}`, { userId: created.id, data: { email: input.email } });
      res.status(201).json({ authenticated: true, needsSetup: false, user: created });
    })
  );

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      const input = loginSchema.parse(req.body);
      const record = usersRepo.getByEmail(input.email);
      if (!record || !record.active || !verifyPassword(input.password, record.passwordHash)) {
        log.warn("auth", `Login failed for ${input.email}`, { data: { email: input.email } });
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      const now = new Date().toISOString();
      usersRepo.touchLogin(record.id, now);
      signIn(res, db, record.id);
      const user = enforceRootAdmin(db, usersRepo.get(record.id)!);
      log.info("auth", `Login succeeded for ${input.email}`, { userId: user.id, data: { email: input.email } });
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
      log.info("auth", `Logout: ${req.user!.email}`, { userId: req.user!.id });
      res.status(204).end();
    })
  );

  router.get(
    "/me",
    asyncHandler(async (req, res) => {
      res.json({
        authenticated: !!req.user,
        needsSetup: usersRepo.count() === 0,
        user: req.user ?? null,
        ...signOnFields(),
      });
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
      log.info("auth", `Password changed: ${req.user!.email}`, { userId: req.user!.id });
      res.status(204).end();
    })
  );

  /* ---------------------------------------------------------------------- */
  /* Magic links                                                             */
  /* ---------------------------------------------------------------------- */

  router.post(
    "/magic/request",
    asyncHandler(async (req, res) => {
      const input = magicLinkRequestSchema.parse(req.body);
      const ip = clientIp(req);
      if (!checkMagicLinkRateLimit(input.email, ip)) {
        res.status(429).json({ error: "Too many sign-in requests. Try again in a few minutes." });
        return;
      }
      const allowed = checkSignOnAllowed(db, input.email);
      if (!allowed.ok) {
        const domains = getAccessPolicy(db).domains.map((d) => `@${d.domain}`).join(" and ");
        log.warn("auth", `Magic link refused for ${input.email} (${allowed.reason})`, { data: { email: input.email, reason: allowed.reason } });
        res.status(403).json({
          error:
            allowed.reason === "inactive"
              ? "This account has been deactivated."
              : `Only ${domains || "approved"} addresses can sign in. Request access if you need an account.`,
          reason: allowed.reason,
        });
        return;
      }
      const { secret } = createMagicLinkToken(db, input.email);
      const link = magicLinkUrl(secret);
      const mail = await sendMail({
        to: input.email,
        subject: "Your suprstar sign-in link",
        text: `Use this link to sign in to suprstar. It expires in 15 minutes.\n\n${link}\n\nIf you didn't request this, you can safely ignore this email.`,
      });
      log.info("auth", `Magic link requested for ${input.email}`, { data: { email: input.email, delivered: mail.delivered } });
      const result: MagicLinkRequestResult =
        mail.delivered === "log" && config.nodeEnv !== "production"
          ? { ok: true, delivered: "log", link }
          : { ok: true, delivered: mail.delivered };
      res.json(result);
    })
  );

  router.get(
    "/magic/verify",
    asyncHandler(async (req, res) => {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      if (!token) {
        res.redirect(authRedirect("invalid"));
        return;
      }
      const verified = verifyMagicLinkToken(db, token);
      if (!verified.ok) {
        res.redirect(authRedirect(verified.reason));
        return;
      }
      const outcome = resolveSignOnUser(db, verified.email);
      if (!outcome.ok) {
        res.redirect(authRedirect(outcome.reason));
        return;
      }
      const now = new Date().toISOString();
      usersRepo.touchLogin(outcome.user.id, now);
      signIn(res, db, outcome.user.id);
      log.info("auth", `Magic link sign-in: ${outcome.user.email}`, {
        userId: outcome.user.id,
        data: { email: outcome.user.email, provisioned: outcome.provisioned },
      });
      res.redirect(authRedirect());
    })
  );

  /* ---------------------------------------------------------------------- */
  /* Google SSO                                                              */
  /* ---------------------------------------------------------------------- */

  router.get("/google/start", (_req, res) => {
    if (!googleConfigured()) {
      res.status(404).json({ error: "Google sign-in is not configured" });
      return;
    }
    const state = generateGoogleState();
    res.cookie(GOOGLE_STATE_COOKIE, state, googleStateCookieOptions());
    res.redirect(googleAuthorizeUrl(state));
  });

  router.get(
    "/google/callback",
    asyncHandler(async (req, res) => {
      if (!googleConfigured()) {
        res.status(404).json({ error: "Google sign-in is not configured" });
        return;
      }
      const cookies = parseCookies(req.headers.cookie);
      const cookieState = cookies[GOOGLE_STATE_COOKIE];
      const queryState = typeof req.query.state === "string" ? req.query.state : "";
      res.clearCookie(GOOGLE_STATE_COOKIE, { path: "/" });
      const code = typeof req.query.code === "string" ? req.query.code : "";
      if (!cookieState || !queryState || cookieState !== queryState || !code) {
        res.redirect(authRedirect("state"));
        return;
      }

      let email: string;
      let sub: string;
      try {
        const tokens = await exchangeGoogleCode(code);
        const userInfo = await fetchGoogleUserInfo(tokens.access_token);
        if (!userInfo.email || userInfo.email_verified !== true) {
          res.redirect(authRedirect("google"));
          return;
        }
        email = userInfo.email.trim().toLowerCase();
        sub = userInfo.sub;
      } catch (err) {
        log.warn("auth", "Google sign-in failed during token exchange", {
          data: { error: err instanceof Error ? err.message : String(err) },
        });
        res.redirect(authRedirect("google"));
        return;
      }

      const outcome = resolveSignOnUser(db, email);
      if (!outcome.ok) {
        res.redirect(authRedirect(outcome.reason));
        return;
      }
      const now = new Date().toISOString();
      usersRepo.update(outcome.user.id, { googleSub: sub, lastLoginAt: now });
      signIn(res, db, outcome.user.id);
      log.info("auth", `Google sign-in: ${email}`, { userId: outcome.user.id, data: { email, provisioned: outcome.provisioned } });
      res.redirect(authRedirect());
    })
  );

  /* ---------------------------------------------------------------------- */
  /* Microsoft Entra ID SSO                                                  */
  /* ---------------------------------------------------------------------- */

  router.get("/entra/start", (_req, res) => {
    if (!entraConfigured()) {
      res.status(404).json({ error: "Microsoft sign-in is not configured" });
      return;
    }
    const { state, nonce } = generateEntraState();
    res.cookie(ENTRA_STATE_COOKIE, state, entraStateCookieOptions());
    res.redirect(entraAuthorizeUrl(state, nonce));
  });

  router.get(
    "/entra/callback",
    asyncHandler(async (req, res) => {
      if (!entraConfigured()) {
        res.status(404).json({ error: "Microsoft sign-in is not configured" });
        return;
      }
      const cookies = parseCookies(req.headers.cookie);
      const cookieState = cookies[ENTRA_STATE_COOKIE];
      const queryState = typeof req.query.state === "string" ? req.query.state : "";
      res.clearCookie(ENTRA_STATE_COOKIE, { path: "/" });
      const code = typeof req.query.code === "string" ? req.query.code : "";
      if (!cookieState || !queryState || cookieState !== queryState || !code) {
        res.redirect(authRedirect("state"));
        return;
      }

      let email: string;
      let subject: string;
      try {
        const nonce = nonceFromState(cookieState);
        const tokens = await exchangeEntraCode(code);
        if (!tokens.id_token) throw new Error("Entra token response is missing id_token");
        const identity = await verifyEntraIdToken(tokens.id_token, nonce);
        email = identity.email;
        subject = identity.subject;
      } catch (err) {
        log.warn("auth", "Microsoft sign-in failed during token exchange or id_token validation", {
          data: { error: err instanceof Error ? err.message : String(err) },
        });
        res.redirect(authRedirect("entra"));
        return;
      }

      const outcome = resolveSignOnUser(db, email);
      if (!outcome.ok) {
        res.redirect(authRedirect(outcome.reason));
        return;
      }
      const now = new Date().toISOString();
      usersRepo.update(outcome.user.id, { entraSub: subject, lastLoginAt: now });
      signIn(res, db, outcome.user.id);
      log.info("auth", `Microsoft sign-in: ${email}`, { userId: outcome.user.id, data: { email, provisioned: outcome.provisioned } });
      res.redirect(authRedirect());
    })
  );

  /* ---------------------------------------------------------------------- */
  /* Access requests (public creation; admin review lives under /users)      */
  /* ---------------------------------------------------------------------- */

  router.post(
    "/access-requests",
    asyncHandler(async (req, res) => {
      const input = accessRequestCreateSchema.parse(req.body);
      const ip = clientIp(req);
      if (!checkAccessRequestRateLimit(ip)) {
        res.status(429).json({ error: "Too many requests. Try again later." });
        return;
      }
      if (usersRepo.getByEmail(input.email)) {
        throw new ConflictError("An account with that email already exists. Try signing in instead.");
      }
      if (accessRequestsRepo.getPendingByEmail(input.email)) {
        throw new ConflictError("A request for that email is already pending review.");
      }
      const now = new Date().toISOString();
      const created = accessRequestsRepo.create({
        id: nanoid(),
        email: input.email,
        name: input.name,
        organization: input.organization ?? null,
        message: input.message ?? null,
        createdAt: now,
      });
      log.info("auth", `Access requested: ${created.email}`, { data: { email: created.email, requestId: created.id } });

      if (mailerStatus().configured) {
        const admins = usersRepo.list().filter((u) => u.active && (u.role === "owner" || u.role === "admin"));
        await Promise.all(
          admins.map((admin) =>
            sendMail({
              to: admin.email,
              subject: "New suprstar access request",
              text: `${created.name} (${created.email}) requested access${created.organization ? ` for ${created.organization}` : ""}.${
                created.message ? `\n\n"${created.message}"` : ""
              }\n\nReview it in suprstar under Settings -> Access requests.`,
            })
          )
        );
      }
      res.status(201).json(created);
    })
  );

  return router;
}
