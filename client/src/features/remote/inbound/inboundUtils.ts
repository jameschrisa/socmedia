import type { InboundBinding, InboundChannel, InboundChannelConfig, InboundChannelStatus, InboundMessage, InboundMessageStatus, InboundTimelineEntry } from "@socmedia/shared";

/** Human label for each channel, used in chips, cards and table cells. */
export const CHANNEL_LABEL: Record<InboundChannel, string> = {
  twilio: "Twilio SMS/MMS/WhatsApp",
  telegram: "Telegram",
  test: "Test channel",
};

export const CHANNEL_SHORT_LABEL: Record<InboundChannel, string> = {
  twilio: "Twilio",
  telegram: "Telegram",
  test: "Test",
};

export const CHANNEL_BLURB: Record<InboundChannel, string> = {
  twilio: "SMS, MMS and WhatsApp through your Twilio number",
  telegram: "A bot anyone on your team can message",
  test: "Try the pipeline without a provider",
};

/** Dot colour for the "listening / off / error" channel state. */
export const CHANNEL_STATE_DOT: Record<InboundChannelStatus["state"], string> = {
  listening: "bg-green-500",
  off: "bg-ink-400",
  error: "bg-red-500",
};

export const CHANNEL_STATE_LABEL: Record<InboundChannelStatus["state"], string> = {
  listening: "Listening",
  off: "Off",
  error: "Error",
};

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

/** Badge tone per message status: published green, draft/awaiting amber, failed red, unknown grey, command cyan. */
export const MESSAGE_STATUS_TONE: Record<InboundMessageStatus, Tone> = {
  received: "neutral",
  unknown_sender: "neutral",
  awaiting_confirmation: "warning",
  processing: "info",
  published: "success",
  draft: "warning",
  command: "info",
  failed: "danger",
  ignored: "neutral",
};

/** Dot colour per message status, for compact lists (right-rail popover) that have no room for a badge. */
export const MESSAGE_STATUS_DOT: Record<InboundMessageStatus, string> = {
  received: "bg-ink-400",
  unknown_sender: "bg-ink-400",
  awaiting_confirmation: "bg-amber-500",
  processing: "bg-sky-500",
  published: "bg-green-500",
  draft: "bg-amber-500",
  command: "bg-sky-500",
  failed: "bg-red-500",
  ignored: "bg-ink-400",
};

export const MESSAGE_STATUS_LABEL: Record<InboundMessageStatus, string> = {
  received: "Received",
  unknown_sender: "Unknown sender",
  awaiting_confirmation: "Awaiting confirmation",
  processing: "Processing",
  published: "Published",
  draft: "Draft",
  command: "Command",
  failed: "Failed",
  ignored: "Ignored",
};

/** Labels for every timeline status, including the reply steps that are not message statuses. */
export const TIMELINE_STATUS_LABEL: Record<InboundTimelineEntry["status"], string> = {
  ...MESSAGE_STATUS_LABEL,
  reply_sent: "Reply sent",
  reply_failed: "Reply failed",
};

/** True when a timeline entry's message only repeats its status (e.g. "command" / "awaiting_confirmation"),
 * so the row can show the label alone. */
export function timelineMessageIsRedundant(entry: InboundTimelineEntry): boolean {
  const norm = (v: string) => v.trim().toLowerCase().replace(/[_\s]+/g, " ");
  const msg = norm(entry.message ?? "");
  if (!msg) return true;
  return msg === norm(entry.status) || msg === norm(TIMELINE_STATUS_LABEL[entry.status] ?? "");
}

/** "No attachments", "1 attachment", "3 attachments". */
export function mediaCountLabel(count: number): string {
  if (count === 0) return "No attachments";
  return count === 1 ? "1 attachment" : `${count} attachments`;
}

/** Masks a phone number or chat id down to its last 4 digits. Names (test-channel senders, labels) are
 * left readable: only ids that carry a run of six or more digits are considered sensitive. */
export function maskSenderId(id: string): string {
  if (!/\d{6,}/.test(id)) return id;
  return `••••${id.slice(-4)}`;
}

/** The sender's label when the message is tied to a binding, otherwise the masked id. */
export function senderDisplayName(message: Pick<InboundMessage, "senderId" | "bindingId">, bindings: InboundBinding[] = []): string {
  const label = message.bindingId ? bindings.find((b) => b.id === message.bindingId)?.senderLabel : null;
  return label || maskSenderId(message.senderId);
}

/** True when the saved config has everything the channel needs. GET /api/inbound/channels returns a row
 * for every channel, configured or not, so "a config exists" is not enough to call a channel ready. */
export function isChannelConfigured(cfg: InboundChannelConfig | null | undefined): boolean {
  if (!cfg || !cfg.enabled) return false;
  if (cfg.channel === "twilio") return !!(cfg.settings.accountSid && cfg.settings.authToken && cfg.settings.fromNumber);
  if (cfg.channel === "telegram") return !!cfg.settings.botToken;
  return true;
}

/** Renders a small branded square as a data URL, for the Test channel's "send a photo" step. Returns null
 * where canvas 2D contexts are unavailable (jsdom in tests, unless the test stubs it). */
export function generateTestImageDataUrl(): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 600;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const gradient = ctx.createLinearGradient(0, 0, 600, 600);
    gradient.addColorStop(0, "#59d8e6");
    gradient.addColorStop(1, "#c86bd9");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 600, 600);
    ctx.fillStyle = "rgba(13,15,22,0.85)";
    ctx.font = "600 42px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("suprstar test", 300, 300);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
