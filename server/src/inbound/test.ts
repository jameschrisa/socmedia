import type { Request } from "express";
import type { ChannelSettings } from "../services/inboundSettings";
import type { InboundAdapter, NormalizedInbound } from "./types";

/**
 * The "test" channel backs the setup wizard and the test suite. It is never reached over the public
 * internet: `POST /api/inbound/test` requires a signed-in admin session and builds the
 * NormalizedInbound directly from the validated request body (see routes/inbound.ts), so `parse`
 * here is unused in practice. `reply` is a no-op because the wizard only needs the reply text that
 * the pipeline already stores on the InboundMessage row; there is no real provider to call.
 */
export const testAdapter: InboundAdapter = {
  channel: "test",
  webhookPath: "/api/inbound/test",

  verify(_req: Request, _settings: ChannelSettings): boolean {
    return true;
  },

  async parse(_req: Request, _settings: ChannelSettings): Promise<NormalizedInbound | null> {
    return null;
  },

  async reply(_settings: ChannelSettings, _senderId: string, _text: string): Promise<void> {
    // Intentionally a no-op; see the module doc comment above.
  },

  describe(_settings: ChannelSettings): Record<string, unknown> {
    return {};
  },
};
