import type { InboundChannel } from "@socmedia/shared";
import type { InboundAdapter } from "./types";
import { telegramAdapter } from "./telegram";
import { testAdapter } from "./test";
import { twilioAdapter } from "./twilio";

export const ADAPTERS: Record<InboundChannel, InboundAdapter> = {
  twilio: twilioAdapter,
  telegram: telegramAdapter,
  test: testAdapter,
};

export function getAdapter(channel: InboundChannel): InboundAdapter {
  return ADAPTERS[channel];
}

export * from "./types";
export { twilioAdapter, twilioWebhookUrl, computeTwilioSignature, setTwilioFetch, resetTwilioFetch } from "./twilio";
export {
  telegramAdapter,
  generateTelegramSecretToken,
  telegramGetMe,
  telegramSetWebhook,
  setTelegramFetch,
  resetTelegramFetch,
} from "./telegram";
export { testAdapter } from "./test";
