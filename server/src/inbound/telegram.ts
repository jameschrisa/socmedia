import crypto from "node:crypto";
import type { Request } from "express";
import type { ChannelSettings } from "../services/inboundSettings";
import type { InboundAdapter, NormalizedInbound } from "./types";

export type FetchLike = typeof fetch;
let fetchImpl: FetchLike = fetch;
/** Test-only: stub Telegram's Bot API without a real network call. */
export function setTelegramFetch(impl: FetchLike): void {
  fetchImpl = impl;
}
export function resetTelegramFetch(): void {
  fetchImpl = fetch;
}

/** Telegram secret tokens must be 1-256 chars of [A-Za-z0-9_-]. */
export function generateTelegramSecretToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export async function telegramGetMe(botToken: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = (await res.json()) as { ok: boolean; result?: { username?: string }; description?: string };
    if (!data.ok) return { ok: false, error: data.description || "getMe failed" };
    return { ok: true, username: data.result?.username };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "getMe failed" };
  }
}

export async function telegramSetWebhook(botToken: string, url: string, secretToken: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, secret_token: secretToken }),
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) return { ok: false, error: data.description || "setWebhook failed" };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "setWebhook failed" };
  }
}

interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
}
interface TelegramMessage {
  chat: { id: number };
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  voice?: { file_id: string; mime_type?: string };
  audio?: { file_id: string; mime_type?: string };
}

async function resolveFileUrl(botToken: string, fileId: string): Promise<string | null> {
  const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const data = (await res.json()) as { ok: boolean; result?: { file_path?: string } };
  if (!data.ok || !data.result?.file_path) return null;
  return `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`;
}

export const telegramAdapter: InboundAdapter = {
  channel: "telegram",
  webhookPath: "/api/inbound/telegram/:secret",

  verify(req: Request, settings: ChannelSettings): boolean {
    const expected = settings.extra.secretToken;
    const provided = req.header("X-Telegram-Bot-Api-Secret-Token");
    if (!expected || !provided) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    try {
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  },

  async parse(req: Request, settings: ChannelSettings): Promise<NormalizedInbound | null> {
    const update = req.body as { update_id?: number; message?: TelegramMessage } | undefined;
    const message = update?.message;
    if (!message) return null;
    const botToken = settings.settings.botToken;
    const providerMessageId = String(update?.update_id ?? `${message.chat.id}-${Date.now()}`);
    const senderId = String(message.chat.id);
    const text = (message.text ?? message.caption ?? "").trim();

    const media: NormalizedInbound["media"] = [];
    let audio: NormalizedInbound["audio"];

    if (message.photo && message.photo.length > 0) {
      const largest = [...message.photo].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const url = await resolveFileUrl(botToken, largest.file_id);
      if (url) media.push({ url, mimeType: "image/jpeg" });
    }
    const voiceOrAudio = message.voice ?? message.audio;
    if (voiceOrAudio) {
      const url = await resolveFileUrl(botToken, voiceOrAudio.file_id);
      if (url) audio = { url, mimeType: voiceOrAudio.mime_type };
    }

    return { providerMessageId, senderId, text, media, audio };
  },

  async reply(settings: ChannelSettings, senderId: string, text: string): Promise<void> {
    const botToken = settings.settings.botToken;
    if (!botToken) throw new Error("Telegram channel is not configured");
    const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: senderId, text }),
    });
    if (!res.ok) throw new Error(`Telegram reply failed with status ${res.status}`);
  },

  describe(settings: ChannelSettings): Record<string, unknown> {
    return { botUsername: settings.extra.botUsername ?? "" };
  },
};
