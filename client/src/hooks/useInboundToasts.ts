import { useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "./useAuth";
import { useInboundStream } from "./useInbound";
import { maskSenderId } from "@/features/settings/inbound/inboundUtils";

/**
 * Toasts once when a chat message finishes publishing or fails, while the app is open.
 * Deduped by message id so a message that later changes status again doesn't toast twice.
 */
export function useInboundToasts() {
  const { can } = useAuth();
  const seen = useRef<Set<string>>(new Set());

  useInboundStream({
    enabled: can.manageSettings,
    onEvent: (event) => {
      if (event.type !== "message") return;
      const { message } = event;
      if (message.status !== "published" && message.status !== "failed") return;
      if (seen.current.has(message.id)) return;
      seen.current.add(message.id);
      const who = message.senderId ? maskSenderId(message.senderId) : "a chat sender";
      const n = message.links.length;
      if (message.status === "published") toast.success(`Posted from chat by ${who}${n > 0 ? ` to ${n} account${n === 1 ? "" : "s"}` : ""}`);
      else toast.error(`Chat message from ${who} failed${message.error ? `: ${message.error}` : ""}`);
    },
  });
}
