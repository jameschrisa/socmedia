import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * iOS-style wheel time picker. Three snap-scrolling columns: hour, minute (step), AM/PM.
 * Value is minutes since midnight (0..1439) so it is timezone-agnostic.
 */
export interface TimeScrollerProps {
  value: number;                 // minutes since midnight
  onChange: (minutes: number) => void;
  minuteStep?: 1 | 5 | 10 | 15 | 30;
  className?: string;
  compact?: boolean;
}

const ITEM_H = 36;

function Column<T extends string | number>({ items, value, onChange, render, ariaLabel }: { items: T[]; value: T; onChange: (v: T) => void; render?: (v: T) => string; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const suppress = useRef(false);

  // keep the wheel aligned with the external value
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = Math.max(0, items.indexOf(value));
    const top = idx * ITEM_H;
    if (Math.abs(el.scrollTop - top) > 1) {
      suppress.current = true;
      el.scrollTo({ top, behavior: "auto" });
      window.setTimeout(() => { suppress.current = false; }, 50);
    }
  }, [value, items]);

  const onScroll = () => {
    if (suppress.current) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const idx = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)));
      const next = items[idx]!;
      if (next !== value) onChange(next);
    }, 80);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = items.indexOf(value);
    if (e.key === "ArrowUp" && idx > 0) { e.preventDefault(); onChange(items[idx - 1]!); }
    if (e.key === "ArrowDown" && idx < items.length - 1) { e.preventDefault(); onChange(items[idx + 1]!); }
  };

  return (
    <div className="relative" style={{ height: ITEM_H * 5 }}>
      <div
        ref={ref}
        role="listbox"
        aria-label={ariaLabel}
        aria-activedescendant={`${ariaLabel}-${String(value)}`}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        className="h-full overflow-y-auto no-scrollbar snap-y snap-mandatory focus:outline-none"
        style={{ paddingTop: ITEM_H * 2, paddingBottom: ITEM_H * 2 }}
      >
        {items.map((item) => {
          const active = item === value;
          return (
            <div
              key={String(item)}
              id={`${ariaLabel}-${String(item)}`}
              role="option"
              aria-selected={active}
              onClick={() => onChange(item)}
              className={cn("flex items-center justify-center snap-center cursor-pointer select-none tabular-nums transition-all", active ? "text-ink-900 text-lg font-semibold" : "text-ink-400 text-sm")}
              style={{ height: ITEM_H }}
            >
              {render ? render(item) : String(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TimeScroller({ value, onChange, minuteStep = 5, className, compact }: TimeScrollerProps) {
  const hours = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const minutes = useMemo(() => Array.from({ length: 60 / minuteStep }, (_, i) => i * minuteStep), [minuteStep]);
  const periods = useMemo(() => ["AM", "PM"] as const, []);

  const h24 = Math.floor(value / 60) % 24;
  const m = value % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const snappedMinute = minutes.reduce((best, cur) => (Math.abs(cur - m) < Math.abs(best - m) ? cur : best), minutes[0]!);

  const emit = (hour12: number, minute: number, p: "AM" | "PM") => {
    const hour24 = (hour12 % 12) + (p === "PM" ? 12 : 0);
    onChange(hour24 * 60 + minute);
  };

  return (
    <div className={cn("relative inline-flex items-stretch rounded-xl border border-ink-200 bg-glass px-2", compact ? "w-56" : "w-64", className)} data-testid="time-scroller">
      {/* selection highlight */}
      <div aria-hidden className="pointer-events-none absolute inset-x-2 rounded-lg bg-brand-50 border border-brand-100" style={{ top: ITEM_H * 2, height: ITEM_H }} />
      <div className="flex-1"><Column items={hours} value={h12} onChange={(h) => emit(h, snappedMinute, period)} render={(h) => String(h)} ariaLabel="hour" /></div>
      <div className="flex items-center text-ink-400 font-semibold" aria-hidden>:</div>
      <div className="flex-1"><Column items={minutes} value={snappedMinute} onChange={(mm) => emit(h12, mm, period)} render={(mm) => String(mm).padStart(2, "0")} ariaLabel="minute" /></div>
      <div className="w-14"><Column items={[...periods]} value={period} onChange={(p) => emit(h12, snappedMinute, p)} ariaLabel="period" /></div>
    </div>
  );
}

/** Helpers to move between a Date and minutes-since-midnight in local time. */
export function minutesOfDay(d: Date): number { return d.getHours() * 60 + d.getMinutes(); }
export function withMinutesOfDay(d: Date, minutes: number): Date {
  const next = new Date(d);
  next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return next;
}
export function formatMinutes(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const p = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${p}`;
}

/** Hook for a controlled scroller with an internal pending state. */
export function useTimeScroller(initial: number) {
  const [minutes, setMinutes] = useState(initial);
  return { minutes, setMinutes, label: formatMinutes(minutes) };
}
