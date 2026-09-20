import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelSettings } from "../services/inboundSettings";
import {
  computeTwilioSignature,
  generateTelegramSecretToken,
  resetTelegramFetch,
  resetTwilioFetch,
  setTelegramFetch,
  setTwilioFetch,
  telegramAdapter,
  telegramGetMe,
  telegramSetWebhook,
  twilioAdapter,
  twilioWebhookUrl,
} from "../inbound";

function fakeRequest(headers: Record<string, string>, body: unknown): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()] ?? headers[name] ?? undefined,
    body,
  } as unknown as Request;
}

function twilioSettings(overrides: Partial<ChannelSettings["settings"]> = {}): ChannelSettings {
  return {
    channel: "twilio",
    enabled: true,
    settings: { accountSid: "AC123", authToken: "secret-token", fromNumber: "+15551234567", ...overrides },
    webhookRegistered: false,
    extra: {},
    updatedAt: null,
  };
}

function telegramSettings(overrides: Partial<ChannelSettings> = {}): ChannelSettings {
  return {
    channel: "telegram",
    enabled: true,
    settings: { botToken: "bot-token-123" },
    webhookRegistered: true,
    extra: { secretToken: "the-secret-token" },
    updatedAt: null,
    ...overrides,
  };
}

describe("twilio adapter", () => {
  afterEach(() => resetTwilioFetch());

  it("accepts a request with a correctly computed signature", () => {
    const settings = twilioSettings();
    const params = { From: "+15559876543", Body: "hello", MessageSid: "SM123" };
    const signature = computeTwilioSignature(settings.settings.authToken, twilioWebhookUrl(), params);
    const req = fakeRequest({ "x-twilio-signature": signature }, params);
    expect(twilioAdapter.verify(req, settings)).toBe(true);
  });

  it("rejects a request with a wrong or missing signature", () => {
    const settings = twilioSettings();
    const params = { From: "+15559876543", Body: "hello", MessageSid: "SM123" };
    const req = fakeRequest({ "x-twilio-signature": "totally-wrong" }, params);
    expect(twilioAdapter.verify(req, settings)).toBe(false);

    const reqNoSig = fakeRequest({}, params);
    expect(twilioAdapter.verify(reqNoSig, settings)).toBe(false);
  });

  it("parses an MMS with an image and keeps the whatsapp: prefix on the sender", async () => {
    const settings = twilioSettings();
    const params = {
      From: "whatsapp:+15559876543",
      Body: "Check this out",
      MessageSid: "SM999",
      NumMedia: "1",
      MediaUrl0: "https://api.twilio.com/media/ME123",
      MediaContentType0: "image/jpeg",
    };
    const req = fakeRequest({}, params);
    const normalized = await twilioAdapter.parse(req, settings);
    expect(normalized).not.toBeNull();
    expect(normalized!.senderId).toBe("whatsapp:+15559876543");
    expect(normalized!.providerMessageId).toBe("SM999");
    expect(normalized!.text).toBe("Check this out");
    expect(normalized!.media).toHaveLength(1);
    expect(normalized!.media[0].url).toBe("https://api.twilio.com/media/ME123");
    expect(normalized!.media[0].headers?.Authorization).toMatch(/^Basic /);
    expect(normalized!.audio).toBeUndefined();
  });

  it("sends a reply through Twilio's REST API", async () => {
    const settings = twilioSettings();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
    setTwilioFetch(fetchMock as unknown as typeof fetch);
    await twilioAdapter.reply(settings, "+15559876543", "hi there");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/Accounts/AC123/Messages.json");
    expect(String(init.body)).toContain("To=%2B15559876543");
  });
});

describe("telegram adapter", () => {
  afterEach(() => resetTelegramFetch());

  it("accepts the correct X-Telegram-Bot-Api-Secret-Token and rejects a wrong one", () => {
    const settings = telegramSettings();
    const ok = fakeRequest({ "x-telegram-bot-api-secret-token": "the-secret-token" }, {});
    expect(telegramAdapter.verify(ok, settings)).toBe(true);
    const bad = fakeRequest({ "x-telegram-bot-api-secret-token": "wrong" }, {});
    expect(telegramAdapter.verify(bad, settings)).toBe(false);
    const missing = fakeRequest({}, {});
    expect(telegramAdapter.verify(missing, settings)).toBe(false);
  });

  it("parses a photo message by resolving the largest size through getFile", async () => {
    const settings = telegramSettings();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/getFile")) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: "photos/file_1.jpg" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });
    setTelegramFetch(fetchMock as unknown as typeof fetch);

    const update = {
      update_id: 42,
      message: {
        chat: { id: 555 },
        caption: "From my phone",
        photo: [
          { file_id: "small", width: 100, height: 100 },
          { file_id: "big", width: 800, height: 800 },
        ],
      },
    };
    const req = fakeRequest({}, update);
    const normalized = await telegramAdapter.parse(req, settings);
    expect(normalized).not.toBeNull();
    expect(normalized!.senderId).toBe("555");
    expect(normalized!.providerMessageId).toBe("42");
    expect(normalized!.text).toBe("From my phone");
    expect(normalized!.media).toHaveLength(1);
    expect(normalized!.media[0].url).toContain("photos/file_1.jpg");
    // getFile should have been called with the largest photo's file_id.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("file_id=big"))).toBe(true);
  });

  it("generates a valid secret token and calls getMe/setWebhook against the stubbed API", async () => {
    const token = generateTelegramSecretToken();
    expect(token.length).toBeGreaterThan(10);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/getMe")) return new Response(JSON.stringify({ ok: true, result: { username: "suprstar_bot" } }), { status: 200 });
      if (url.includes("/setWebhook")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });
    setTelegramFetch(fetchMock as unknown as typeof fetch);

    const me = await telegramGetMe("bot-token");
    expect(me.ok).toBe(true);
    expect(me.username).toBe("suprstar_bot");

    const hook = await telegramSetWebhook("bot-token", "https://example.com/hook", token);
    expect(hook.ok).toBe(true);
  });
});
