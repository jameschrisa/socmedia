import { Sparkles } from "lucide-react";
import { PLATFORMS, PLATFORM_SPECS, type Platform } from "@socmedia/shared";
import { Badge, PlatformIcon, Skeleton } from "@/components/ui";
import { cn, relativeTime } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { useAiStore, type AiTabId } from "./aiStore";

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Multi-select platform chips, used by every generation tab. */
export function PlatformChips({ value, onChange }: { value: Platform[]; onChange: (v: Platform[]) => void }) {
  function toggle(p: Platform) {
    onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  }
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Platforms">
      {PLATFORMS.map((p) => {
        const active = value.includes(p);
        return (
          <button
            key={p}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(p)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              active ? "border-brand-300 bg-brand-50 text-brand-700" : "border-ink-200 bg-glass text-ink-600 hover:bg-ink-50",
            )}
          >
            <PlatformIcon platform={p} size={16} />
            {PLATFORM_SPECS[p].name}
          </button>
        );
      })}
    </div>
  );
}

/** Shimmering skeleton cards shown while a generation request is in flight. */
export function ThinkingSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-live="polite" aria-busy="true">
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600">
        <Sparkles className="h-3.5 w-3.5 animate-pulse" aria-hidden />
        Thinking…
      </p>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card space-y-2 p-4">
          <Skeleton className="h-4 w-1/3 animate-shimmer bg-[length:400px_100%] bg-gradient-to-r from-ink-100 via-ink-50 to-ink-100" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** Inline error banner with a retry action for any AI mutation. */
export function ApiErrorNotice({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Something went wrong. Please try again.";
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="shrink-0 rounded-md border border-red-300 bg-glass px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100">
        Retry
      </button>
    </div>
  );
}

/** Placeholder shown in the results column before anything has been generated yet. */
export function ResultsPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex min-h-[10rem] items-center justify-center border border-dashed border-ink-200 p-6 text-center text-sm text-ink-400">
      {text}
    </div>
  );
}

/** Compact "Recent" list of past generations for a given tab, backed by the shared history store. */
export function RecentList({ tab }: { tab: AiTabId }) {
  const history = useAiStore((s) => s.history).filter((h) => h.tab === tab);
  if (history.length === 0) return null;
  return (
    <div className="space-y-1.5 border-t border-ink-100 pt-3">
      <p className="label">Recent</p>
      <ul className="space-y-1">
        {history.slice(0, 5).map((h) => (
          <li key={h.id} className="flex items-center justify-between gap-2 text-xs text-ink-500">
            <span className="truncate">{h.label || "Untitled"}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {h.mock && (
                <Badge tone="warning" className="px-1.5 py-0 text-[9px]">
                  mock
                </Badge>
              )}
              {relativeTime(new Date(h.createdAt).toISOString())}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
