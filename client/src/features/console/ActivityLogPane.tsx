import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Pause, Play } from "lucide-react";
import type { LogLevel, LogSource } from "@socmedia/shared";
import { Select, SegmentedTabs } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { useLogStream } from "./useLogStream";
import { LogLine } from "./LogLine";
import { LogFilesPanel } from "./LogFilesPanel";
import { DEFAULT_LOG_FILTERS, matchesTextFilter, type LogFilterState } from "./consoleUtils";

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

/** Right-pane "Activity log" tab: the live server log stream with filters, pause, jump-to-latest,
 * plus an admin-only "Log files" sub-tab for the on-disk rotated logs. */
export function ActivityLogPane({ active = true }: { active?: boolean }) {
  const { can } = useAuth();
  const [tab, setTab] = useState<"stream" | "files">("stream");
  const [filters, setFilters] = useState<LogFilterState>(DEFAULT_LOG_FILTERS);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { entries, setEntries, status } = useLogStream({
    enabled: active && tab === "stream",
    level: filters.level,
    source: filters.source,
    paused,
  });

  const items = useMemo(
    () => entries.filter((e) => matchesTextFilter(e.message, filters.q)),
    [entries, filters.q],
  );

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

  const dotClass = status === "open" ? "bg-green-500" : status === "paused" ? "bg-amber-500" : status === "error" ? "bg-red-500" : "bg-ink-400 animate-pulse";
  const dotLabel = status === "open" ? "Connected" : status === "paused" ? "Paused" : status === "error" ? "Reconnecting…" : "Connecting…";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-3 py-1.5" style={{ borderColor: "var(--c-edge)" }}>
        <span className="flex items-center gap-1.5 text-[11px] text-ink-500" title={dotLabel}>
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} data-testid="console-connection-dot" />
          {dotLabel}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {can.manageSettings && (
            <SegmentedTabs
              size="sm"
              value={tab}
              onChange={setTab}
              items={[{ id: "stream", label: "Stream" }, { id: "files", label: "Log files" }]}
            />
          )}
          {tab === "stream" && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Resume stream" : "Pause stream"}
              title={paused ? "Resume stream" : "Pause stream"}
              className="focus-ring console-tap flex h-7 w-7 items-center justify-center text-ink-500 hover:bg-glass-veil hover:text-ink-900"
            >
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {tab === "stream" ? (
        <>
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
            {items.length > 0 && (
              <button type="button" onClick={() => setEntries([])} className="focus-ring console-tap text-xs text-ink-500 underline underline-offset-2 hover:text-ink-900">
                Clear
              </button>
            )}
          </div>

          <div className="relative min-h-0 flex-1">
            <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto scrollbar-thin py-1" data-testid="console-scroll">
              {items.length === 0 && (
                <div className="px-3 py-3 text-xs leading-relaxed text-ink-500" data-testid="console-empty">
                  <p>{filters.q || filters.level || filters.source ? "Nothing matches these filters." : "Console is clear."}</p>
                  <p className="mt-1">
                    {filters.q || filters.level || filters.source
                      ? "Widen the level or source filter, or clear the text filter."
                      : "Server log lines stream in here as they happen."}
                  </p>
                </div>
              )}
              {items.map((entry) => <LogLine key={entry.id} entry={entry} />)}
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
        </>
      ) : (
        <LogFilesPanel />
      )}
    </div>
  );
}
