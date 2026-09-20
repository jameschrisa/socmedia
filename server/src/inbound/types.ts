import type { Request } from "express";
import type { InboundChannel } from "@socmedia/shared";
import type { ChannelSettings } from "../services/inboundSettings";

export interface NormalizedInboundMedia {
  url: string;
  mimeType?: string;
  /** Extra headers needed to fetch the media (e.g. Twilio's HTTP basic auth). */
  headers?: Record<string, string>;
}

/** A chat message reduced to the shape the inbound pipeline understands, regardless of channel. */
export interface NormalizedInbound {
  providerMessageId: string;
  senderId: string;
  senderLabel?: string;
  text: string;
  media: NormalizedInboundMedia[];
  audio?: NormalizedInboundMedia;
}

/** Common interface every channel adapter implements; see server/src/inbound/*.ts. */
export interface InboundAdapter {
  channel: InboundChannel;
  /** Express path (relative to /api/inbound) the provider posts events to, for documentation/status only. */
  webhookPath: string;
  /** Verifies the request really came from the provider (signature/secret-token check). */
  verify(req: Request, settings: ChannelSettings): boolean;
  /** Reduces the provider's webhook payload to a NormalizedInbound, or null when there's nothing to process. */
  parse(req: Request, settings: ChannelSettings): Promise<NormalizedInbound | null>;
  /** Sends a text reply back to the sender through the provider's API. */
  reply(settings: ChannelSettings, senderId: string, text: string): Promise<void>;
  /** Small, display-safe facts about the current configuration (used by the status/config endpoints). */
  describe(settings: ChannelSettings): Record<string, unknown>;
}
