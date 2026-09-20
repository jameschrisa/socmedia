import crypto from "node:crypto";
import type { Request } from "express";
import { config } from "../config";
import type { ChannelSettings } from "../services/inboundSettings";
import type { InboundAdapter, NormalizedInbound } from "./types";

export type FetchLike = typeof fetch;
let fetchImpl: FetchLike = fetch;
/** Test-only: stub Twilio's REST API without a real network call. */
export function setTwilioFetch(impl: FetchLike): void {
  fetchImpl = impl;
}
export function resetTwilioFetch(): void {
  fetchImpl = fetch;
}

/** The exact URL Twilio must be configured with; also the one the signature is computed against. */
export function twilioWebhookUrl(): string {
  const base = (config.publicBaseUrl || config.clientUrl || "").replace(/\/+$/, "");
  return `${base}/api/inbound/twilio`;
}

/** HMAC-SHA1 of the full URL + sorted POST params (RFC: Twilio's request-validation algorithm), base64-encoded. */
export function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export const twilioAdapter: InboundAdapter = {
  channel: "twilio",
  webhookPath: "/api/inbound/twilio",

  verify(req: Request, settings: ChannelSettings): boolean {
    const authToken = settings.settings.authToken;
    const signature = req.header("X-Twilio-Signature");
    if (!authToken || !signature) return false;
    const params = (req.body ?? {}) as Record<string, string>;
    const expected = computeTwilioSignature(authToken, twilioWebhookUrl(), params);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    try {
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  },

  async parse(req: Request, settings: ChannelSettings): Promise<NormalizedInbound | null> {
    const body = (req.body ?? {}) as Record<string, string>;
    const from = body.From;
    const messageSid = body.MessageSid;
    if (!from || !messageSid) return null;
    const text = (body.Body ?? "").trim();
    const numMedia = Number.parseInt(body.NumMedia ?? "0", 10) || 0;
    const authHeader = `Basic ${Buffer.from(`${settings.settings.accountSid}:${settings.settings.authToken}`).toString("base64")}`;
    const media: NormalizedInbound["media"] = [];
    let audio: NormalizedInbound["audio"];
    for (let i = 0; i < numMedia; i++) {
      const url = body[`MediaUrl${i}`];
      if (!url) continue;
      const mimeType = body[`MediaContentType${i}`];
      const item = { url, mimeType, headers: { Authorization: authHeader } };
      if (mimeType?.startsWith("audio/")) {
        if (!audio) audio = item;
      } else {
        media.push(item);
      }
    }
    // WhatsApp senders arrive as "whatsapp:+E164"; keep the prefix so replies route back correctly.
    return { providerMessageId: messageSid, senderId: from, text, media, audio };
  },

  async reply(settings: ChannelSettings, senderId: string, text: string): Promise<void> {
    const { accountSid, authToken, fromNumber } = settings.settings;
    if (!accountSid || !authToken || !fromNumber) throw new Error("Twilio channel is not fully configured");
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const body = new URLSearchParams({ From: fromNumber, To: senderId, Body: text });
    const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Twilio reply failed with status ${res.status}`);
  },

  describe(settings: ChannelSettings): Record<string, unknown> {
    return { accountSid: settings.settings.accountSid ?? "", fromNumber: settings.settings.fromNumber ?? "" };
  },
};
