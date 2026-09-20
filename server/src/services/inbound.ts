import { PLATFORM_SPECS } from "@socmedia/shared";
import { nanoid } from "nanoid";
import type {
  InboundChannel,
  InboundChannelStatus,
  InboundEvent,
  InboundMessage,
  InboundMessageStatus,
  InboundStatus,
  InboundTimelineEntry,
  QuickPostLink,
} from "@socmedia/shared";
import type { Db } from "../db/database";
import { ConnectionsRepo } from "../db/repositories/connections";
import { InboundBindingsRepo } from "../db/repositories/inboundBindings";
import { InboundMessagesRepo } from "../db/repositories/inboundMessages";
import type { UpdateInboundMessagePatch } from "../db/repositories/inboundMessages";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { UsersRepo } from "../db/repositories/users";
import { getAdapter } from "../inbound";
import type { NormalizedInbound } from "../inbound/types";
import { executeAgentCommand } from "../routes/agent";
import type { AgentToolContext } from "./agentTools";
import { getChannelSettings, isChannelConfigured, webhookUrlFor } from "./inboundSettings";
import { log } from "./logger";
import { createAndPublishQuickPost, publishQuickPostFromMedia, resolveQuickTargets, saveQuickPostImage } from "./quickPost";
import { getTranscriptionSettings, transcriptionConfigured } from "./transcriptionSettings";

const CONFIRMATION_WINDOW_MS = 30 * 60 * 1000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/* ---------------------------------------------------------------------- */
/* Pub/sub for GET /api/inbound/stream (same shape as services/logger.ts) */
/* ---------------------------------------------------------------------- */
type InboundListener = (event: InboundEvent) => void;
const listeners = new Set<InboundListener>();

/** Subscribes to every inbound message/status change; returns an unsubscribe function. */
export function subscribeInbound(fn: InboundListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(event: InboundEvent): void {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {
      // a broken subscriber (e.g. a dead SSE connection) must not break the pipeline
    }
  }
}

/** Masks a phone number/chat id to its last 4 characters for logs ("...1234"), stripping "whatsapp:". */
export function maskSender(senderId: string): string {
  const clean = senderId.replace(/^whatsapp:/, "");
  const last4 = clean.length <= 4 ? clean : clean.slice(-4);
  return `••••${last4}`;
}

function timelineEntry(status: InboundTimelineEntry["status"], message: string): InboundTimelineEntry {
  return { at: new Date().toISOString(), status, message };
}

/* ---------------------------------------------------------------------- */
/* Status                                                                  */
/* ---------------------------------------------------------------------- */

const ALL_CHANNELS: InboundChannel[] = ["twilio", "telegram", "test"];

export function getInboundStatus(db: Db): InboundStatus {
  const bindingsRepo = new InboundBindingsRepo(db);
  const messagesRepo = new InboundMessagesRepo(db);
  const channels: InboundChannelStatus[] = ALL_CHANNELS.map((channel) => {
    const settings = getChannelSettings(db, channel);
    const configured = isChannelConfigured(settings);
    const counts = messagesRepo.countsForChannel(channel);
    const latest = messagesRepo.listAll({ channel, limit: 1 })[0];
    let state: InboundChannelStatus["state"] = "off";
    let detail: string | null = null;
    if (channel === "test") {
      state = "listening";
    } else if (!configured) {
      detail = "Missing required settings.";
    } else if (!settings.enabled) {
      detail = "Disabled.";
    } else if (channel === "telegram" && !settings.webhookRegistered) {
      state = "error";
      detail = "Configured but the Telegram webhook has not been registered yet.";
    } else {
      state = "listening";
    }
    return {
      channel,
      configured,
      enabled: settings.enabled,
      state,
      detail,
      webhookUrl: webhookUrlFor(channel, channel === "telegram" ? settings.extra.secretToken : undefined),
      lastEventAt: latest?.receivedAt ?? null,
      counts,
    };
  });
  const transcription = getTranscriptionSettings(db);
  return {
    channels,
    bindings: bindingsRepo.count(),
    transcription: { configured: transcriptionConfigured(db), provider: transcription.provider },
  };
}

export function emitInboundStatus(db: Db): void {
  emit({ type: "status", status: getInboundStatus(db) });
}

/* ---------------------------------------------------------------------- */
/* Media download + transcription                                         */
/* ---------------------------------------------------------------------- */

export type FetchLike = typeof fetch;
let fetchImpl: FetchLike = fetch;
/** Test-only: stub the media/transcription HTTP calls without a real network call. */
export function setInboundFetch(impl: FetchLike): void {
  fetchImpl = impl;
}
export function resetInboundFetch(): void {
  fetchImpl = fetch;
}

interface DownloadedMedia {
  buffer: Buffer;
  mimeType: string;
}

/** Downloads a NormalizedInbound media item; handles both http(s) URLs (with optional auth headers) and data: URLs. */
async function downloadMedia(item: { url: string; mimeType?: string; headers?: Record<string, string> }): Promise<DownloadedMedia> {
  if (item.url.startsWith("data:")) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(item.url);
    if (!match) throw new Error("Invalid data URL");
    return { buffer: Buffer.from(match[2], "base64"), mimeType: item.mimeType || match[1] };
  }
  const res = await fetchImpl(item.url, { headers: item.headers });
  if (!res.ok) throw new Error(`Failed to download media (status ${res.status})`);
  const arrayBuffer = await res.arrayBuffer();
  const contentType = item.mimeType || res.headers.get("content-type") || "application/octet-stream";
  return { buffer: Buffer.from(arrayBuffer), mimeType: contentType };
}

/** Transcribes a downloaded audio clip with the configured provider; returns null when unconfigured or on any failure. */
async function transcribeAudio(db: Db, media: DownloadedMedia): Promise<string | null> {
  const settings = getTranscriptionSettings(db);
  if (settings.provider === "none" || !settings.apiKey) return null;
  try {
    if (settings.provider === "openai") {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(media.buffer)], { type: media.mimeType || "audio/ogg" }), "audio");
      form.append("model", "whisper-1");
      const res = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.apiKey}` },
        body: form,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { text?: string };
      return data.text?.trim() || null;
    }
    if (settings.provider === "deepgram") {
      const res = await fetchImpl("https://api.deepgram.com/v1/listen", {
        method: "POST",
        headers: { Authorization: `Token ${settings.apiKey}`, "Content-Type": media.mimeType || "audio/ogg" },
        body: new Uint8Array(media.buffer),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
      return data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || null;
    }
  } catch (err) {
    log.warn("inbound", `Transcription failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }
  return null;
}

/** Turns a set of publish links into the reply text and the message status they imply. */
function replyForLinks(links: QuickPostLink[]): { status: InboundMessageStatus; text: string; level: "info" | "warn" } {
  if (links.length === 0) {
    return { status: "failed", text: "No enabled accounts to post to. Ask an owner to check your suprstar link.", level: "warn" };
  }
  const failed = links.filter((l) => l.status === "failed");
  if (failed.length === links.length) {
    const detail = links.map((l) => `${l.label || l.platform}: ${l.error || "failed"}`).join("\n");
    return { status: "failed", text: `Couldn't post to any accounts:\n${detail}`, level: "warn" };
  }
  const lines = [
    `Posted to ${links.length} account${links.length === 1 ? "" : "s"}:`,
    ...links.map((l) => `${l.label || l.platform} ${l.url || (l.error ? `(${l.error})` : "")}`.trim()),
  ];
  return { status: "published", text: lines.join("\n"), level: "info" };
}

/**
 * Reduces one normalized inbound chat message to whatever suprstar should do with it: link a phone
 * number/chat id, run a slash command, confirm/publish a pending post, save a draft, or publish a
 * new post outright. Every transition is persisted on the InboundMessage row, logged, and pushed to
 * GET /api/inbound/stream subscribers. Idempotent per (channel, providerMessageId): a duplicate
 * delivery from the provider returns the already-processed message unchanged.
 */
export async function processInbound(db: Db, channel: InboundChannel, normalized: NormalizedInbound): Promise<InboundMessage> {
  const messagesRepo = new InboundMessagesRepo(db);
  const bindingsRepo = new InboundBindingsRepo(db);
  const orgsRepo = new OrganizationsRepo(db);
  const usersRepo = new UsersRepo(db);
  const connectionsRepo = new ConnectionsRepo(db);

  const existing = messagesRepo.getByProviderMessageId(channel, normalized.providerMessageId);
  if (existing) return existing;

  const receivedAt = new Date().toISOString();
  log.info("inbound", `Message received from ${channel} ${maskSender(normalized.senderId)}`, {
    data: { channel, providerMessageId: normalized.providerMessageId },
  });

  let message = messagesRepo.create({
    id: nanoid(),
    channel,
    providerMessageId: normalized.providerMessageId,
    senderId: normalized.senderId,
    text: normalized.text,
    mediaCount: normalized.media.length,
    hasAudio: !!normalized.audio,
    status: "received",
    timeline: [timelineEntry("received", "Message received")],
    receivedAt,
  });
  emit({ type: "message", message });

  const settings = getChannelSettings(db, channel);
  const adapter = getAdapter(channel);

  function persist(patch: UpdateInboundMessagePatch): void {
    message = messagesRepo.update(message.id, patch)!;
    emit({ type: "message", message });
  }

  function addTimeline(status: InboundTimelineEntry["status"], text: string): InboundTimelineEntry[] {
    return [...message.timeline, timelineEntry(status, text)];
  }

  /** Persists the final status + data, logs it, and (if replyText is set) sends + records the chat reply. */
  async function finish(
    status: InboundMessageStatus,
    patch: UpdateInboundMessagePatch,
    replyText: string | null,
    repliedBy: "system" | "agent" | null,
    level: "info" | "warn" = "info"
  ): Promise<InboundMessage> {
    persist({ ...patch, status, timeline: addTimeline(status, `${status}${patch.error ? `: ${patch.error}` : ""}`), completedAt: new Date().toISOString() });
    log[level]("inbound", `Inbound message ${message.id} on ${channel} -> ${status}`, {
      orgId: message.orgId,
      userId: message.userId,
      data: { inboundMessageId: message.id, status },
    });
    if (replyText) {
      persist({ reply: replyText, repliedBy });
      try {
        await adapter.reply(settings, normalized.senderId, replyText);
        persist({ timeline: addTimeline("reply_sent", "Reply sent") });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Failed to send reply";
        log.warn("inbound", `Failed to send reply on ${channel}: ${errMsg}`, { data: { inboundMessageId: message.id } });
        persist({ timeline: addTimeline("reply_failed", errMsg) });
      }
    }
    emitInboundStatus(db);
    return message;
  }

  /* ---- 1. No verified binding yet: try a verification code, else refuse. ---- */
  const verifiedBinding = bindingsRepo.getVerifiedByChannelAndSender(channel, normalized.senderId);
  if (!verifiedBinding) {
    const code = normalized.text.trim();
    if (/^\d{6}$/.test(code)) {
      const pending =
        bindingsRepo.getPendingByChannelSenderAndCode(channel, normalized.senderId, code) ??
        bindingsRepo.getPendingByChannelAndCode(channel, code);
      if (pending) {
        const verifiedAt = new Date().toISOString();
        const updated = bindingsRepo.update(pending.id, { senderId: normalized.senderId, status: "verified", verifiedAt })!;
        const org = orgsRepo.get(updated.orgId);
        return finish(
          "command",
          { bindingId: updated.id, orgId: updated.orgId, userId: updated.userId },
          `Linked to ${org?.name ?? "suprstar"}. Send a photo with a caption to post.`,
          "system"
        );
      }
    }
    return finish(
      "unknown_sender",
      {},
      "This number isn't linked to suprstar. Ask an owner for a link code.",
      "system",
      "warn"
    );
  }

  bindingsRepo.update(verifiedBinding.id, { lastMessageAt: receivedAt });
  persist({ bindingId: verifiedBinding.id, orgId: verifiedBinding.orgId, userId: verifiedBinding.userId });

  const text = normalized.text.trim();

  /* ---- 2. Slash commands run through the same agent as the console. ---- */
  if (text.startsWith("/")) {
    const org = orgsRepo.get(verifiedBinding.orgId);
    const user = usersRepo.get(verifiedBinding.userId);
    if (!org || !user) {
      return finish(
        "failed",
        { error: "Binding points at a missing organization or user" },
        "Something is misconfigured with this link; ask an owner to recreate it.",
        "system",
        "warn"
      );
    }
    const ctx: AgentToolContext = { db, org, user };
    try {
      const result = await executeAgentCommand(ctx, text);
      return finish("command", {}, result.reply, "agent");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Command failed";
      return finish("failed", { error: errMsg }, `Command failed: ${errMsg}`, "system", "warn");
    }
  }

  /* ---- 3. YES/NO replies to a pending confirm-before-posting message. ---- */
  const lower = text.toLowerCase();
  if (lower === "yes" || lower === "y" || lower === "post") {
    const awaiting = messagesRepo.getLatestAwaitingConfirmation(channel, normalized.senderId);
    const withinWindow = !!awaiting && Date.now() - Date.parse(awaiting.receivedAt) <= CONFIRMATION_WINDOW_MS;
    if (!awaiting || !withinWindow) return finish("ignored", {}, null, null);
    const mediaId = awaiting.mediaIds[0];
    if (!mediaId) {
      return finish("failed", { error: "Missing media for confirmation" }, "Couldn't find that pending post anymore; send the photo again.", "system", "warn");
    }
    try {
      const result = await publishQuickPostFromMedia({
        db,
        orgId: verifiedBinding.orgId,
        mediaId,
        caption: awaiting.text,
        connectionIds: verifiedBinding.connectionIds,
        publishMode: verifiedBinding.publishMode,
        labels: ["inbound", channel],
      });
      const r = replyForLinks(result.links);
      const awaitingUpdated = messagesRepo.update(awaiting.id, {
        status: r.status,
        postId: result.post.id,
        links: result.links,
        completedAt: new Date().toISOString(),
        timeline: [...awaiting.timeline, timelineEntry(r.status, "Confirmed by a follow-up message")],
      });
      if (awaitingUpdated) emit({ type: "message", message: awaitingUpdated });
      return finish(r.status, { postId: result.post.id, mediaIds: [mediaId], links: result.links }, r.text, "system", r.level);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Failed to publish";
      return finish("failed", { error: errMsg }, `Couldn't post that: ${errMsg}`, "system", "warn");
    }
  }
  if (lower === "no") {
    return finish("ignored", {}, null, null);
  }

  /* ---- 4. A new photo (+ optional caption/voice note). ---- */
  if (normalized.media.length === 0 && !normalized.audio) {
    return finish("ignored", {}, "Send a photo with a caption to post.", "system");
  }

  let imageBuffer: Buffer | null = null;
  let imageMimeType = "";
  const imageItem = normalized.media[0];
  if (imageItem) {
    try {
      const downloaded = await downloadMedia(imageItem);
      if (downloaded.buffer.length > MAX_IMAGE_BYTES) {
        return finish("failed", { error: "Image too large" }, "That image is too large (max 15MB). Try a smaller photo.", "system", "warn");
      }
      if (!downloaded.mimeType.startsWith("image/")) {
        return finish("failed", { error: "Unsupported media type" }, "Only photos can be posted from chat right now.", "system", "warn");
      }
      imageBuffer = downloaded.buffer;
      imageMimeType = downloaded.mimeType;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Failed to download media";
      return finish("failed", { error: errMsg }, "Couldn't download that photo; please try sending it again.", "system", "warn");
    }
  }

  if (!imageBuffer) {
    // Audio-only with no photo attached: nothing to build a post around.
    return finish("ignored", {}, "Send a photo with a caption to post.", "system");
  }

  let caption = text;
  if (!caption && normalized.audio) {
    try {
      const downloadedAudio = await downloadMedia(normalized.audio);
      const transcript = await transcribeAudio(db, downloadedAudio);
      if (transcript) caption = transcript;
    } catch (err) {
      log.warn("inbound", `Failed to download/transcribe audio: ${err instanceof Error ? err.message : "unknown error"}`, {
        data: { inboundMessageId: message.id },
      });
    }
  }

  if (!caption) {
    const created = await createAndPublishQuickPost({
      db,
      orgId: verifiedBinding.orgId,
      userId: verifiedBinding.userId,
      imageBuffer,
      imageMimeType,
      caption: "",
      connectionIds: verifiedBinding.connectionIds,
      publishMode: verifiedBinding.publishMode,
      labels: ["inbound", channel],
      source: "inbound",
    });
    return finish("draft", { postId: created.post.id, mediaIds: [created.media.id] }, "Saved as a draft: add a caption in suprstar.", "system");
  }

  const targets = resolveQuickTargets(db, verifiedBinding.orgId, verifiedBinding.connectionIds);
  const targetNames =
    targets
      .map((t) => {
        const conn = connectionsRepo.get(t.connectionId);
        const platformName = PLATFORM_SPECS[t.platform].name;
        // "X (Founder)" rather than the org name, which several accounts share as their display name.
        return conn?.label ? `${platformName} (${conn.label})` : platformName;
      })
      .join(", ") || "no enabled accounts";

  if (verifiedBinding.confirmBeforePosting) {
    const media = await saveQuickPostImage(db, verifiedBinding.orgId, imageBuffer, imageMimeType, "inbound");
    const replyText = `${caption}\n\nPosting to: ${targetNames}.\nReply YES to post or NO to discard.`;
    // Persist the resolved caption (it may have come from a transcript, not the raw message text) so
    // the later "yes" reply can find it via getLatestAwaitingConfirmation()/awaiting.text.
    return finish("awaiting_confirmation", { text: caption, mediaIds: [media.id] }, replyText, "system");
  }

  try {
    const created = await createAndPublishQuickPost({
      db,
      orgId: verifiedBinding.orgId,
      userId: verifiedBinding.userId,
      imageBuffer,
      imageMimeType,
      caption,
      connectionIds: verifiedBinding.connectionIds,
      publishMode: verifiedBinding.publishMode,
      labels: ["inbound", channel],
      source: "inbound",
    });
    if (created.status === "needs_caption") {
      return finish("draft", { postId: created.post.id, mediaIds: [created.media.id] }, "Saved as a draft: add a caption in suprstar.", "system");
    }
    const r = replyForLinks(created.links);
    return finish(r.status, { postId: created.post.id, mediaIds: [created.media.id], links: created.links }, r.text, "system", r.level);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Failed to publish";
    return finish("failed", { error: errMsg }, `Couldn't post that: ${errMsg}`, "system", "warn");
  }
}
