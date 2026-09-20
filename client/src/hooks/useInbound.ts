import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  InboundBindingCreateInput, InboundBindingUpdateInput, InboundChannel, InboundChannelConfigUpdateInput,
  InboundEvent, InboundMessage, InboundMessageStatus, TranscriptionSettingsInput,
} from "@socmedia/shared";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { reconnectDelay } from "@/features/console/consoleUtils";

export function useInboundStatus(opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: qk.inboundStatus, queryFn: api.inbound.status, ...opts });
}

export function useInboundChannels(opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: qk.inboundChannels, queryFn: api.inbound.channels.list, ...opts });
}

export function useInboundChannelMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.inboundChannels });
    qc.invalidateQueries({ queryKey: qk.inboundStatus });
  };
  const save = useMutation({
    mutationFn: ({ channel, input }: { channel: InboundChannel; input: InboundChannelConfigUpdateInput }) => api.inbound.channels.save(channel, input),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (channel: InboundChannel) => api.inbound.channels.remove(channel), onSuccess: invalidate });
  const registerTelegram = useMutation({ mutationFn: () => api.inbound.channels.registerTelegram(), onSuccess: invalidate });
  return { save, remove, registerTelegram };
}

/** `refetchInterval` lets the setup wizard poll while a binding is still pending, as a fallback to the SSE stream. */
export function useInboundBindings(opts: { refetchInterval?: number | false; enabled?: boolean } = {}) {
  return useQuery({ queryKey: qk.inboundBindings, queryFn: api.inbound.bindings.list, ...opts });
}

export function useInboundBindingMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.inboundBindings });
    qc.invalidateQueries({ queryKey: qk.inboundStatus });
  };
  const create = useMutation({ mutationFn: (input: InboundBindingCreateInput) => api.inbound.bindings.create(input), onSuccess: invalidate });
  const update = useMutation({ mutationFn: ({ id, input }: { id: string; input: InboundBindingUpdateInput }) => api.inbound.bindings.update(id, input), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api.inbound.bindings.remove(id), onSuccess: invalidate });
  return { create, update, remove };
}

export function useInboundMessages(params: { limit?: number; status?: InboundMessageStatus; channel?: InboundChannel } = {}, opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: qk.inboundMessages(params), queryFn: () => api.inbound.messages.list(params), ...opts });
}

export function useInboundMessageMutations() {
  const qc = useQueryClient();
  const replace = (msg: InboundMessage) => {
    qc.setQueriesData<InboundMessage[]>({ queryKey: ["inbound", "messages"] }, (old) => old?.map((m) => (m.id === msg.id ? msg : m)));
  };
  const confirm = useMutation({ mutationFn: (id: string) => api.inbound.messages.confirm(id), onSuccess: replace });
  const discard = useMutation({ mutationFn: (id: string) => api.inbound.messages.discard(id), onSuccess: replace });
  return { confirm, discard };
}

export function useInboundTranscription() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: qk.inboundTranscription, queryFn: api.inbound.transcription.get });
  const save = useMutation({
    mutationFn: (input: TranscriptionSettingsInput) => api.inbound.transcription.update(input),
    onSuccess: (data) => {
      qc.setQueryData(qk.inboundTranscription, data);
      qc.invalidateQueries({ queryKey: qk.inboundStatus });
    },
  });
  return { ...query, save };
}

/** The wizard's synchronous "send a test" step: POST /api/inbound/test, no provider required. */
export function useInboundTestSend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { senderId: string; text: string; imageUrl?: string }) => api.inbound.test(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbound", "messages"] }),
  });
}

export type InboundStreamStatus = "connecting" | "open" | "error";

/**
 * Subscribes to `/api/inbound/stream` (event: "inbound"). Reconnects on error with capped
 * exponential backoff, same policy as the console's log stream.
 */
export function useInboundStream(opts: { enabled: boolean; onEvent?: (event: InboundEvent) => void }) {
  const { enabled, onEvent } = opts;
  const [status, setStatus] = useState<InboundStreamStatus>("connecting");
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const retryRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    let cancelled = false;
    let es: EventSource | null = null;

    function connect() {
      if (cancelled) return;
      setStatus("connecting");
      es = new EventSource(api.inbound.streamUrl(), { withCredentials: true });
      es!.addEventListener("open", () => {
        retryRef.current = 0;
        setStatus("open");
      });
      es!.addEventListener("inbound", (ev: MessageEvent) => {
        try {
          const event = JSON.parse(ev.data) as InboundEvent;
          onEventRef.current?.(event);
        } catch {
          // malformed event; ignore
        }
      });
      es!.addEventListener("error", () => {
        setStatus("error");
        es?.close();
        if (cancelled) return;
        const delay = reconnectDelay(retryRef.current);
        retryRef.current += 1;
        timeoutRef.current = setTimeout(connect, delay);
      });
    }

    connect();
    return () => {
      cancelled = true;
      es?.close();
      clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { status };
}
