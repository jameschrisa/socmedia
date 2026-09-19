import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LogEntry, LogLevel, LogSource } from "@socmedia/shared";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { reconnectDelay } from "./consoleUtils";

export type ConnectionStatus = "connecting" | "open" | "paused" | "error";

const MAX_ENTRIES = 2000;

/**
 * Loads the last 200 log entries, then subscribes to the SSE stream for live updates.
 * Reconnects on error with exponential backoff (capped at 8s). While `paused`, incoming
 * entries are dropped so the view holds still until the user resumes.
 */
export function useLogStream(opts: { enabled: boolean; level?: LogLevel | ""; source?: LogSource | ""; paused: boolean }) {
  const { enabled, level, source, paused } = opts;
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const pausedRef = useRef(paused);
  const retryRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { pausedRef.current = paused; if (paused) setStatus("paused"); }, [paused]);

  const initial = useQuery({
    queryKey: qk.logs({ level: level || undefined, source: source || undefined }),
    queryFn: () => api.logs.list({ limit: 200, level: level || undefined, source: source || undefined }),
    enabled,
  });

  useEffect(() => {
    if (initial.data) setEntries(initial.data.entries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.data]);

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    let cancelled = false;
    let es: EventSource | null = null;

    function connect() {
      if (cancelled) return;
      if (!pausedRef.current) setStatus("connecting");
      const url = api.logs.streamUrl({ level: level || undefined, source: source || undefined });
      es = new EventSource(url, { withCredentials: true });
      es.addEventListener("open", () => {
        retryRef.current = 0;
        if (!pausedRef.current) setStatus("open");
      });
      es.addEventListener("log", (ev: MessageEvent) => {
        if (pausedRef.current) return;
        try {
          const entry = JSON.parse(ev.data) as LogEntry;
          setEntries((old) => (old.length >= MAX_ENTRIES ? [...old.slice(old.length - MAX_ENTRIES + 1), entry] : [...old, entry]));
        } catch {
          // malformed event; ignore
        }
      });
      es.addEventListener("error", () => {
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
  }, [enabled, level, source]);

  return { entries, setEntries, status, loading: initial.isLoading };
}
