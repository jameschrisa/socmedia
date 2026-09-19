import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation } from "@tanstack/react-query";
import { ArrowDown, Pause, Play, Terminal as TerminalIcon, Trash2, X } from "lucide-react";
import type { AgentCommandResult, LogLevel, LogSource } from "@socmedia/shared";
import { Portal, Select, SegmentedTabs } from "@/components/ui";
import { useAppStore, CONSOLE_MIN_HEIGHT } from "@/store/appStore";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLogStream } from "./useLogStream";
import { LogLine, SimpleLine } from "./LogLine";
import { ConsoleInput } from "./ConsoleInput";
import { LogFilesPanel } from "./LogFilesPanel";
import { DEFAULT_LOG_FILTERS, matchesTextFilter, type LogFilterState } from "./consoleUtils";

type LocalItem =
  | { kind: "command"; id: string; at: number; text: string }
  | { kind: "reply"; id: string; at: number; result: AgentCommandResult }
  | { kind: "error"; id: string; at: number; text: string }
  | { kind: "system"; id: string; at: number; text: string };

const LEVEL_OPTIONS: { value: LogLevel | ""; label: string }[] = [
  { value: "", label: "All levels" },
  { value: "debug", label: "Debug" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warn" },
  { value: "error", label: "Error" },
];
const SOURCE_OPTIONS: { value: LogSource | ""; label: string }[] = [
  { value: "", label: "All sources" },
  { value: "http", label: "http" },
  { value: "auth", label: "auth" },
  { value: "scheduler", label: "scheduler" },
  { value: "publisher", label: "publisher" },
  { value: "media", label: "media" },
  { value: "agent", label: "agent" },
  { value: "quick", label: "quick" },
  { value: "system", label: "system" },
];

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : "Something went wrong";
}

/** Bottom drawer: a live terminal of server log entries plus a command line into the agent. */
export function ConsoleDrawer() {
  const consoleOpen = useAppStore((s) => s.consoleOpen);
  const setConsoleOpen = useAppStore((s) => s.setConsoleOpen);
  const toggleConsole = useAppStore((s) => s.toggleConsole);
  const consoleHeight = useAppStore((s) => s.consoleHeight);
  const setConsoleHeight = useAppStore((s) => s.setConsoleHeight);
  const history = useAppStore((s) => s.consoleHistory);
  const pushHistory = useAppStore((s) => s.pushConsoleHistory);
  const { can } = useAuth();

  const [tab, setTab] = useState<"terminal" | "files">("terminal");
  const [filters, setFilters] = useState<LogFilterState>(DEFAULT_LOG_FILTERS);
  const [paused, setPaused] = useState(false);
  const [localItems, setLocalItems] = useState<LocalItem[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const { entries, setEntries, status } = useLogStream({
    enabled: consoleOpen && tab === "terminal",
    level: filters.level,
    source: filters.source,
    paused,
  });

  const agentMutation = useMutation({
    mutationFn: (input: string) => api.agent.command(input),
  });

  // Keyboard shortcut: Ctrl+` toggles the drawer from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === "Backquote") {
        e.preventDefault();
        toggleConsole();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleConsole]);

  // Reserve room under the page so content never hides behind the fixed drawer.
  useEffect(() => {
    if (!consoleOpen) return;
    const prev = document.body.style.paddingBottom;
    document.body.style.paddingBottom = `${consoleHeight}px`;
    return () => { document.body.style.paddingBottom = prev; };
  }, [consoleOpen, consoleHeight]);

  const items = useMemo(() => {
    const logItems = entries
      .filter((e) => matchesTextFilter(e.message, filters.q))
      .map((e) => ({ kind: "log" as const, id: e.id, at: Date.parse(e.at) || 0, entry: e }));
    const local = localItems.filter((i) => {
      if (i.kind === "command") return matchesTextFilter(i.text, filters.q);
      if (i.kind === "reply") return matchesTextFilter(i.result.reply, filters.q);
      return matchesTextFilter(i.text, filters.q);
    });
    return [...logItems, ...local].sort((a, b) => a.at - b.at);
  }, [entries, localItems, filters.q]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAutoScroll(true);
  }, []);

  useEffect(() => {
    if (autoScroll) scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setAutoScroll(nearBottom);
  };

  const clearAll = () => {
    setLocalItems([]);
    setEntries([]);
  };

  const runCommand = (text: string) => {
    if (text === "/clear") {
      clearAll();
      return;
    }
    const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setLocalItems((old) => [...old, { kind: "command", id, at: Date.now(), text }]);
    pushHistory(text);
    agentMutation.mutate(text, {
      onSuccess: (result) => {
        setLocalItems((old) => [...old, { kind: "reply", id: `${id}-reply`, at: Date.now(), result }]);
      },
      onError: (e) => {
        setLocalItems((old) => [...old, { kind: "error", id: `${id}-error`, at: Date.now(), text: errorMessage(e) }]);
      },
    });
  };

  const startDrag = (e: React.PointerEvent) => {
    dragRef.current = { startY: e.clientY, startHeight: consoleHeight };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const delta = dragRef.current.startY - e.clientY;
    const next = Math.min(window.innerHeight - 80, Math.max(CONSOLE_MIN_HEIGHT, dragRef.current.startHeight + delta));
    setConsoleHeight(next);
  };
  const endDrag = () => { dragRef.current = null; };
  const onHandleKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 80 : 24;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const delta = e.key === "ArrowUp" ? step : -step;
      setConsoleHeight(Math.min(window.innerHeight - 80, Math.max(CONSOLE_MIN_HEIGHT, consoleHeight + delta)));
    }
  };

  const dotClass = status === "open" ? "bg-green-500" : status === "paused" ? "bg-amber-500" : status === "error" ? "bg-red-500" : "bg-ink-400 animate-pulse";
  const dotLabel = status === "open" ? "Connected" : status === "paused" ? "Paused" : status === "error" ? "Reconnecting…" : "Connecting…";

  return (
    <Portal>
      <AnimatePresence>
        {consoleOpen && (
          <motion.div
            role="region"
            aria-label="Console"
            data-testid="console-drawer"
            className="terminal fixed inset-x-0 bottom-0 z-[95] flex flex-col border-t shadow-pop"
            style={{ height: consoleHeight, borderColor: "var(--c-edge-strong)" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
          >
            {/* Drag handle */}
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize console"
              aria-valuenow={consoleHeight}
              aria-valuemin={CONSOLE_MIN_HEIGHT}
              tabIndex={0}
              title="Drag to resize. Arrow keys resize from the keyboard."
              className="term-grip flex shrink-0 cursor-row-resize items-center justify-center"
              onPointerDown={startDrag}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={onHandleKey}
              data-testid="console-drag-handle"
            >
              <span className="h-1 w-10 rounded-full bg-ink-300 transition-colors" aria-hidden />
            </div>

            {/* Header */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-3 py-1.5" style={{ borderColor: "var(--c-edge)" }}>
              <div className="flex min-w-0 items-center gap-2">
                <TerminalIcon className="h-4 w-4 shrink-0 text-brand-300" aria-hidden />
                <span className="text-sm font-semibold text-ink-900">Console</span>
                <span className="flex items-center gap-1.5 text-[11px] text-ink-500" title={dotLabel}>
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} data-testid="console-connection-dot" />
                  <span className="hidden sm:inline">{dotLabel}</span>
                  <span className="sr-only sm:hidden">{dotLabel}</span>
                </span>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                {can.manageSettings && (
                  <SegmentedTabs
                    size="sm"
                    value={tab}
                    onChange={setTab}
                    items={[{ id: "terminal", label: "Terminal" }, { id: "files", label: "Log files" }]}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setPaused((p) => !p)}
                  aria-label={paused ? "Resume stream" : "Pause stream"}
                  title={paused ? "Resume stream" : "Pause stream"}
                  className="focus-ring flex h-9 w-9 items-center justify-center text-ink-500 hover:bg-glass-veil hover:text-ink-900 sm:h-7 sm:w-7"
                >
                  {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  aria-label="Clear console"
                  title="Clear console"
                  className="focus-ring flex h-9 w-9 items-center justify-center text-ink-500 hover:bg-glass-veil hover:text-ink-900 sm:h-7 sm:w-7"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setConsoleOpen(false)}
                  aria-label="Close console"
                  className="focus-ring flex h-9 w-9 items-center justify-center text-ink-500 hover:bg-glass-veil hover:text-ink-900 sm:h-7 sm:w-7"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {tab === "terminal" ? (
              <>
                {/* Filters */}
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5" style={{ borderColor: "var(--c-edge)" }}>
                  <Select
                    aria-label="Filter by level"
                    value={filters.level}
                    onChange={(e) => setFilters((f) => ({ ...f, level: e.target.value as LogLevel | "" }))}
                    className="!h-7 !w-auto !py-0 pr-7 text-xs"
                  >
                    {LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                  <Select
                    aria-label="Filter by source"
                    value={filters.source}
                    onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value as LogSource | "" }))}
                    className="!h-7 !w-auto !py-0 pr-7 text-xs"
                  >
                    {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                  <label className="sr-only" htmlFor="console-search">Search log messages</label>
                  <input
                    id="console-search"
                    type="search"
                    value={filters.q}
                    onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                    placeholder="Filter by text…"
                    className="h-7 min-w-[10rem] flex-1 bg-transparent px-2 text-xs text-ink-900 placeholder:text-ink-500 focus:outline-none"
                  />
                </div>

                {/* Log lines */}
                <div className="relative min-h-0 flex-1">
                  <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto scrollbar-thin py-1" data-testid="console-scroll">
                    {items.length === 0 && (
                      <div className="px-3 py-3 text-xs leading-relaxed text-ink-500" data-testid="console-empty">
                        <p>{filters.q || filters.level || filters.source ? "Nothing matches these filters." : "Console is clear."}</p>
                        <p className="mt-1">
                          {filters.q || filters.level || filters.source
                            ? "Widen the level or source filter, or clear the text filter."
                            : <>Server log lines stream in here as they happen. Type <span className="text-brand-300">/help</span> below to see what the agent can do.</>}
                        </p>
                      </div>
                    )}
                    {items.map((item) => {
                      if (item.kind === "log") return <LogLine key={item.id} entry={item.entry} />;
                      if (item.kind === "command") return <div key={item.id} className="term-cmd"><SimpleLine prefix="you ❯" text={item.text} /></div>;
                      if (item.kind === "error") return <SimpleLine key={item.id} prefix="agent ❯" text={item.text} tone="error" />;
                      if (item.kind === "system") return <SimpleLine key={item.id} text={item.text} tone="muted" />;
                      return (
                        <div key={item.id} className="term-reply">
                          <SimpleLine prefix="agent ❯" text={item.result.reply} />
                          {item.result.actions.map((a, i) => (
                            <SimpleLine key={`${item.id}-action-${i}`} text={`↳ ${a.tool}: ${a.summary}`} tone="muted" />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                  {!autoScroll && (
                    <button
                      type="button"
                      onClick={scrollToBottom}
                      className="absolute bottom-2 left-1/2 -translate-x-1/2 chip border-brand-400 bg-brand-50 text-brand-300 shadow-pop"
                      data-testid="jump-to-latest"
                    >
                      <ArrowDown className="h-3 w-3" /> Jump to latest
                    </button>
                  )}
                </div>

                <ConsoleInput history={history} pending={agentMutation.isPending} onSubmit={runCommand} />
              </>
            ) : (
              <LogFilesPanel />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  );
}
