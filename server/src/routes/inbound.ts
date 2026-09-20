import express, { Router } from "express";
import { nanoid } from "nanoid";
import {
  inboundBindingCreateSchema,
  inboundBindingUpdateSchema,
  inboundChannelConfigUpdateSchema,
  inboundChannelSchema,
  inboundTestMessageSchema,
  transcriptionSettingsSchema,
} from "@socmedia/shared";
import type { InboundBinding, InboundChannel, InboundMessage, User } from "@socmedia/shared";
import type { Db } from "../db/database";
import { InboundBindingsRepo } from "../db/repositories/inboundBindings";
import { InboundMessagesRepo } from "../db/repositories/inboundMessages";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { requireRole } from "../middleware/auth";
import { BadRequestError, ForbiddenError, NotFoundError } from "../middleware/errors";
import { generateTelegramSecretToken, getAdapter, telegramGetMe, telegramSetWebhook } from "../inbound";
import type { NormalizedInbound } from "../inbound/types";
import {
  deleteChannelSettings,
  getChannelSettings,
  isChannelConfigured,
  publicChannelConfig,
  saveChannelSettings,
  setChannelExtra,
  webhookUrlFor,
} from "../services/inboundSettings";
import { emitInboundStatus, getInboundStatus, maskSender, processInbound, subscribeInbound } from "../services/inbound";
import { log } from "../services/logger";
import { getPublicTranscriptionSettings, saveTranscriptionSettings } from "../services/transcriptionSettings";
import { asyncHandler } from "../utils/asyncHandler";

const PING_INTERVAL_MS = 20_000;
const ALL_CHANNELS: InboundChannel[] = ["twilio", "telegram", "test"];

/** True when `user` may see/act on things scoped to `orgId` (admins/owners see everything). */
function canAccessOrg(user: User, orgId: string): boolean {
  if (user.role === "admin" || user.role === "owner") return true;
  return user.orgIds === "*" || user.orgIds.includes(orgId);
}

function toPublicBinding(record: InboundBinding, includeCode: boolean): InboundBinding {
  const { verificationCode, ...rest } = record;
  return includeCode ? { ...rest, verificationCode } : rest;
}

/** Public webhook endpoints (Twilio, Telegram) plus every signed-in inbound-messaging management route. */
export function inboundRouter(db: Db): Router {
  const router = Router();
  const bindingsRepo = new InboundBindingsRepo(db);
  const messagesRepo = new InboundMessagesRepo(db);
  const orgsRepo = new OrganizationsRepo(db);

  /* ------------------------------------------------------------------ */
  /* Public provider webhooks                                            */
  /* ------------------------------------------------------------------ */

  // Twilio posts application/x-www-form-urlencoded; the global app-level express.json() middleware
  // ignores it, so this route parses its own body.
  router.post(
    "/twilio",
    express.urlencoded({ extended: false }),
    asyncHandler(async (req, res) => {
      const settings = getChannelSettings(db, "twilio");
      const adapter = getAdapter("twilio");
      if (!settings.enabled || !isChannelConfigured(settings) || !adapter.verify(req, settings)) {
        res.status(403).end();
        return;
      }
      res.status(200).type("text/xml").send("<Response/>");
      try {
        const normalized = await adapter.parse(req, settings);
        if (normalized) await processInbound(db, "twilio", normalized);
      } catch (err) {
        log.error("inbound", `Failed to process Twilio webhook: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    })
  );

  // Telegram posts JSON; the secret token identifies + authenticates the webhook (Telegram does not sign the body).
  router.post(
    "/telegram/:secret",
    asyncHandler(async (req, res) => {
      const settings = getChannelSettings(db, "telegram");
      const adapter = getAdapter("telegram");
      if (!settings.enabled || !isChannelConfigured(settings) || !adapter.verify(req, settings)) {
        res.status(403).end();
        return;
      }
      res.status(200).json({ ok: true });
      try {
        const normalized = await adapter.parse(req, settings);
        if (normalized) await processInbound(db, "telegram", normalized);
      } catch (err) {
        log.error("inbound", `Failed to process Telegram webhook: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    })
  );

  /* ------------------------------------------------------------------ */
  /* Status + channel configuration (admin+)                             */
  /* ------------------------------------------------------------------ */

  router.get(
    "/status",
    requireRole("admin"),
    asyncHandler(async (_req, res) => {
      res.json(getInboundStatus(db));
    })
  );

  router.get(
    "/channels",
    requireRole("admin"),
    asyncHandler(async (_req, res) => {
      res.json(ALL_CHANNELS.map((channel) => publicChannelConfig(db, channel)));
    })
  );

  router.put(
    "/channels/:channel",
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const channel = inboundChannelSchema.parse(req.params.channel);
      const input = inboundChannelConfigUpdateSchema.parse(req.body);
      saveChannelSettings(db, channel, input);

      if (channel === "telegram") {
        const settings = getChannelSettings(db, "telegram");
        if (settings.settings.botToken) {
          const me = await telegramGetMe(settings.settings.botToken);
          if (me.ok) {
            const secretToken = settings.extra.secretToken || generateTelegramSecretToken();
            const url = webhookUrlFor("telegram", secretToken);
            const hook = await telegramSetWebhook(settings.settings.botToken, url, secretToken);
            setChannelExtra(db, "telegram", {
              webhookRegistered: hook.ok,
              extra: { botUsername: me.username ?? "", secretToken },
            });
            if (!hook.ok) log.warn("inbound", `Telegram setWebhook failed: ${hook.error}`);
          } else {
            setChannelExtra(db, "telegram", { webhookRegistered: false });
            log.warn("inbound", `Telegram getMe failed: ${me.error}`);
            emitInboundStatus(db);
            res.status(400).json({ error: `Telegram rejected this token: ${me.error || "check it and try again"}`, config: publicChannelConfig(db, "telegram") });
            return;
          }
        }
      }

      log.info("inbound", `Channel "${channel}" configuration updated`, { userId: req.user!.id, data: { channel } });
      emitInboundStatus(db);
      res.json(publicChannelConfig(db, channel));
    })
  );

  router.delete(
    "/channels/:channel",
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const channel = inboundChannelSchema.parse(req.params.channel);
      deleteChannelSettings(db, channel);
      log.info("inbound", `Channel "${channel}" configuration removed`, { userId: req.user!.id, data: { channel } });
      emitInboundStatus(db);
      res.status(204).end();
    })
  );

  router.post(
    "/channels/telegram/register",
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const settings = getChannelSettings(db, "telegram");
      if (!settings.settings.botToken) throw new BadRequestError("Set a bot token before registering the webhook");
      const me = await telegramGetMe(settings.settings.botToken);
      if (!me.ok) throw new BadRequestError(`Telegram rejected the bot token: ${me.error}`);
      const secretToken = settings.extra.secretToken || generateTelegramSecretToken();
      const url = webhookUrlFor("telegram", secretToken);
      const hook = await telegramSetWebhook(settings.settings.botToken, url, secretToken);
      setChannelExtra(db, "telegram", {
        webhookRegistered: hook.ok,
        extra: { botUsername: me.username ?? "", secretToken },
      });
      if (!hook.ok) throw new BadRequestError(`Telegram rejected the webhook: ${hook.error}`);
      log.info("inbound", "Telegram webhook (re)registered", { userId: req.user!.id });
      emitInboundStatus(db);
      res.json(publicChannelConfig(db, "telegram"));
    })
  );

  /* ------------------------------------------------------------------ */
  /* Transcription settings (admin+)                                     */
  /* ------------------------------------------------------------------ */

  router.get(
    "/transcription",
    requireRole("admin"),
    asyncHandler(async (_req, res) => {
      res.json(getPublicTranscriptionSettings(db));
    })
  );

  router.put(
    "/transcription",
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const input = transcriptionSettingsSchema.parse(req.body);
      const result = saveTranscriptionSettings(db, input);
      log.info("inbound", `Transcription provider set to "${input.provider}"`, { userId: req.user!.id });
      emitInboundStatus(db);
      res.json(result);
    })
  );

  /* ------------------------------------------------------------------ */
  /* Bindings (editor+, org-scoped; admins see/manage every org)         */
  /* ------------------------------------------------------------------ */

  router.get(
    "/bindings",
    requireRole("editor"),
    asyncHandler(async (req, res) => {
      const user = req.user!;
      if (user.role === "admin" || user.role === "owner") {
        res.json(bindingsRepo.listAll().map((b) => toPublicBinding(b, false)));
        return;
      }
      const orgId = req.header("X-Org-Id");
      if (!orgId) throw new BadRequestError("Missing X-Org-Id header");
      if (!canAccessOrg(user, orgId)) throw new ForbiddenError("You do not have access to this organization");
      res.json(bindingsRepo.listByOrg(orgId).map((b) => toPublicBinding(b, false)));
    })
  );

  router.post(
    "/bindings",
    requireRole("editor"),
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const orgId = req.header("X-Org-Id");
      if (!orgId) throw new BadRequestError("Missing X-Org-Id header");
      if (!canAccessOrg(user, orgId)) throw new ForbiddenError("You do not have access to this organization");
      const org = orgsRepo.get(orgId);
      if (!org) throw new BadRequestError(`Unknown organization: ${orgId}`);

      const input = inboundBindingCreateSchema.parse(req.body);
      const preVerified = req.query.verified === "true";
      if (preVerified && user.role !== "admin" && user.role !== "owner") {
        throw new ForbiddenError("Only an admin can create a pre-verified binding");
      }

      const now = new Date().toISOString();
      const verificationCode = preVerified ? undefined : String(Math.floor(100000 + Math.random() * 900000));
      const created = bindingsRepo.create({
        id: nanoid(),
        channel: input.channel,
        senderId: input.senderId,
        senderLabel: input.senderLabel ?? null,
        userId: user.id,
        orgId,
        connectionIds: input.connectionIds,
        publishMode: input.publishMode,
        confirmBeforePosting: input.confirmBeforePosting,
        status: preVerified ? "verified" : "pending",
        verificationCode: verificationCode ?? null,
        createdAt: now,
        verifiedAt: preVerified ? now : null,
      });
      log.info("inbound", `Binding created for ${input.channel} ${maskSender(input.senderId)}`, {
        orgId,
        userId: user.id,
        data: { bindingId: created.id, status: created.status },
      });
      emitInboundStatus(db);
      res.status(201).json(toPublicBinding(created, true));
    })
  );

  function loadBindingForWrite(req: express.Request): ReturnType<InboundBindingsRepo["get"]> {
    const existing = bindingsRepo.get(req.params.id);
    if (!existing) throw new NotFoundError(`Binding ${req.params.id} not found`);
    if (!canAccessOrg(req.user!, existing.orgId)) throw new ForbiddenError("You do not have access to this organization");
    return existing;
  }

  router.patch(
    "/bindings/:id",
    requireRole("editor"),
    asyncHandler(async (req, res) => {
      const existing = loadBindingForWrite(req)!;
      const input = inboundBindingUpdateSchema.parse(req.body);
      if (input.status === "verified" && req.user!.role !== "admin" && req.user!.role !== "owner") {
        throw new ForbiddenError("Only an admin can force-verify a binding");
      }
      const updated = bindingsRepo.update(existing.id, {
        senderLabel: input.senderLabel,
        connectionIds: input.connectionIds,
        publishMode: input.publishMode,
        confirmBeforePosting: input.confirmBeforePosting,
        status: input.status,
        verifiedAt: input.status === "verified" ? new Date().toISOString() : undefined,
      })!;
      log.info("inbound", `Binding ${updated.id} updated`, { orgId: updated.orgId, userId: req.user!.id, data: { status: updated.status } });
      emitInboundStatus(db);
      res.json(toPublicBinding(updated, false));
    })
  );

  router.delete(
    "/bindings/:id",
    requireRole("editor"),
    asyncHandler(async (req, res) => {
      const existing = loadBindingForWrite(req)!;
      bindingsRepo.delete(existing.id);
      log.info("inbound", `Binding ${existing.id} deleted`, { orgId: existing.orgId, userId: req.user!.id });
      emitInboundStatus(db);
      res.status(204).end();
    })
  );

  /* ------------------------------------------------------------------ */
  /* Messages (editor+, org-scoped; admins see/manage every org)         */
  /* ------------------------------------------------------------------ */

  router.get(
    "/messages",
    requireRole("editor"),
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const status = typeof req.query.status === "string" ? (req.query.status as InboundMessage["status"]) : undefined;
      const channel = typeof req.query.channel === "string" ? (req.query.channel as InboundChannel) : undefined;
      const limitRaw = req.query.limit;
      const limit = typeof limitRaw === "string" && /^\d+$/.test(limitRaw) ? Math.min(500, Math.max(1, Number(limitRaw))) : 100;

      if (user.role === "admin" || user.role === "owner") {
        res.json(messagesRepo.listAll({ status, channel, limit }));
        return;
      }
      const orgId = req.header("X-Org-Id");
      if (!orgId) throw new BadRequestError("Missing X-Org-Id header");
      if (!canAccessOrg(user, orgId)) throw new ForbiddenError("You do not have access to this organization");
      res.json(messagesRepo.listByOrg(orgId, { status, channel, limit }));
    })
  );

  router.get(
    "/messages/:id",
    requireRole("editor"),
    asyncHandler(async (req, res) => {
      const message = messagesRepo.get(req.params.id);
      if (!message) throw new NotFoundError(`Message ${req.params.id} not found`);
      if (message.orgId && !canAccessOrg(req.user!, message.orgId)) throw new ForbiddenError("You do not have access to this organization");
      res.json(message);
    })
  );

  function requireOwnerOfBindingOrAdmin(req: express.Request, message: InboundMessage): void {
    const user = req.user!;
    if (user.role === "admin" || user.role === "owner") return;
    const binding = message.bindingId ? bindingsRepo.get(message.bindingId) : undefined;
    if (!binding || binding.userId !== user.id) throw new ForbiddenError("Only the owner of this link or an admin can do that");
  }

  router.post(
    "/messages/:id/confirm",
    requireRole("editor"),
    asyncHandler(async (req, res) => {
      const message = messagesRepo.get(req.params.id);
      if (!message) throw new NotFoundError(`Message ${req.params.id} not found`);
      requireOwnerOfBindingOrAdmin(req, message);
      if (message.status !== "awaiting_confirmation") throw new BadRequestError("This message is not awaiting confirmation");
      const normalized: NormalizedInbound = { providerMessageId: `${message.providerMessageId}:confirm:${nanoid(6)}`, senderId: message.senderId, text: "yes", media: [] };
      const result = await processInbound(db, message.channel, normalized);
      res.json(result);
    })
  );

  router.post(
    "/messages/:id/discard",
    requireRole("editor"),
    asyncHandler(async (req, res) => {
      const message = messagesRepo.get(req.params.id);
      if (!message) throw new NotFoundError(`Message ${req.params.id} not found`);
      requireOwnerOfBindingOrAdmin(req, message);
      if (message.status !== "awaiting_confirmation") throw new BadRequestError("This message is not awaiting confirmation");
      const updated = messagesRepo.update(message.id, {
        status: "ignored",
        completedAt: new Date().toISOString(),
        timeline: [...message.timeline, { at: new Date().toISOString(), status: "ignored", message: "Discarded from the console" }],
      })!;
      log.info("inbound", `Message ${message.id} discarded`, { orgId: message.orgId, userId: req.user!.id });
      res.json(updated);
    })
  );

  /* ------------------------------------------------------------------ */
  /* Live stream (any signed-in user; org-filtered for non-admins)       */
  /* ------------------------------------------------------------------ */

  router.get("/stream", (req, res) => {
    const user = req.user!;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    // First bytes right away: proxies forward the response and the browser fires EventSource "open".
    res.write(": connected\n\n");

    const visible = (orgId: string | null | undefined): boolean => {
      if (user.role === "admin" || user.role === "owner") return true;
      if (!orgId) return true;
      return user.orgIds === "*" || user.orgIds.includes(orgId);
    };

    const unsubscribe = subscribeInbound((event) => {
      if (event.type === "message" && !visible(event.message.orgId)) return;
      res.write(`event: inbound\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const pingTimer = setInterval(() => res.write(": ping\n\n"), PING_INTERVAL_MS);

    req.on("close", () => {
      clearInterval(pingTimer);
      unsubscribe();
    });
  });

  /* ------------------------------------------------------------------ */
  /* Test channel (admin+): drives the pipeline synchronously             */
  /* ------------------------------------------------------------------ */

  router.post(
    "/test",
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const input = inboundTestMessageSchema.parse(req.body);
      const media: NormalizedInbound["media"] = input.imageUrl ? [{ url: input.imageUrl }] : [];
      const normalized: NormalizedInbound = {
        providerMessageId: nanoid(),
        senderId: input.senderId,
        text: input.text,
        media,
      };
      const result = await processInbound(db, "test", normalized);
      res.json(result);
    })
  );

  return router;
}
