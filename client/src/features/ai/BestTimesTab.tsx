import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarClock, Clock } from "lucide-react";
import { PLATFORM_SPECS, PLATFORMS, type Platform } from "@socmedia/shared";
import { Field, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { useAppStore } from "@/store/appStore";
import { WEEKDAY_SHORT } from "./aiShared";
import { nextOccurrence } from "./aiUtils";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const HOUR_MARKS = HOURS.filter((h) => h % 3 === 0);

function slotLabel(weekday: number, hour: number): string {
  return `${WEEKDAY_SHORT[weekday]} ${format(new Date(2020, 0, 1, hour), "h a")}`;
}

/** Discrete brand-tint bucket for a heatmap cell, from "no data" to "strongest engagement". */
function heatClass(intensity: number): string {
  if (intensity <= 0) return "bg-ink-50";
  if (intensity < 0.2) return "bg-brand-50";
  if (intensity < 0.4) return "bg-brand-100";
  if (intensity < 0.6) return "bg-brand-200";
  if (intensity < 0.8) return "bg-brand-300";
  if (intensity < 0.95) return "bg-brand-400";
  return "bg-brand-500";
}

/**
 * Full "Best times to post" tab: a weekday x hour engagement heatmap plus a ranked list of the
 * strongest slots. Clicking any cell or list item opens a new post scheduled for the next
 * occurrence of that day/hour, same as the old footer widget did.
 */
export function BestTimesTab() {
  const [platform, setPlatform] = useState<Platform>("instagram");
  const openComposer = useAppStore((s) => s.openComposer);

  const query = useQuery({
    queryKey: ["ai", "bestTimes", platform],
    queryFn: () => api.ai.bestTimes(platform),
  });

  const slots = query.data?.slots ?? [];
  const maxScore = useMemo(() => slots.reduce((m, s) => Math.max(m, s.score), 0), [slots]);
  const scoreByCell = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of slots) map.set(`${s.weekday}-${s.hour}`, s.score);
    return map;
  }, [slots]);
  const top = useMemo(() => [...slots].sort((a, b) => b.score - a.score).slice(0, 12), [slots]);

  function schedule(weekday: number, hour: number) {
    openComposer(null, { scheduledAt: nextOccurrence(weekday, hour).toISOString() });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="space-y-4">
        <Field label="Platform" htmlFor="ai-besttimes-platform" hint="Based on this platform's post history and engagement.">
          <Select
            id="ai-besttimes-platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_SPECS[p].name}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-sm text-ink-500">
          Darker cells mean stronger historical engagement for that day and hour. Click any cell, or any time in the list, to open a
          new post scheduled for the next occurrence.
        </p>

        {query.isLoading && <Skeleton className="h-48 w-full" />}
        {!query.isLoading && slots.length === 0 && <p className="text-sm text-ink-400">No engagement data yet for this platform.</p>}
        {!query.isLoading && slots.length > 0 && (
          <div className="overflow-x-auto" data-testid="best-times-heatmap">
            <table className="border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="w-10" scope="col" />
                  {HOUR_MARKS.map((h) => (
                    <th key={h} colSpan={3} scope="col" className="pb-1 text-center text-[10px] font-medium text-ink-400">
                      {format(new Date(2020, 0, 1, h), "ha")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {WEEKDAY_SHORT.map((label, weekday) => (
                  <tr key={weekday}>
                    <th scope="row" className="pr-2 text-right text-[11px] font-medium text-ink-500">
                      {label}
                    </th>
                    {HOURS.map((hour) => {
                      const score = scoreByCell.get(`${weekday}-${hour}`) ?? 0;
                      const intensity = maxScore > 0 ? score / maxScore : 0;
                      return (
                        <td key={hour} className="p-0">
                          <button
                            type="button"
                            title={`${slotLabel(weekday, hour)} · score ${Math.round(score)}`}
                            aria-label={`Schedule for ${slotLabel(weekday, hour)}`}
                            onClick={() => schedule(weekday, hour)}
                            className={`h-4 w-4 border border-ink-100 transition-transform hover:z-10 hover:scale-125 ${heatClass(intensity)}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <p className="label">Top times to post</p>
        {query.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {!query.isLoading && top.length === 0 && <p className="text-sm text-ink-400">No data yet.</p>}
        {top.length > 0 && (
          <ul className="space-y-2">
            {top.map((slot) => (
              <li key={`${slot.weekday}-${slot.hour}`}>
                <button
                  type="button"
                  onClick={() => schedule(slot.weekday, slot.hour)}
                  className="flex w-full items-center justify-between gap-3 border border-ink-200 bg-glass px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:border-brand-300 hover:bg-brand-50"
                >
                  <span className="inline-flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-ink-400" aria-hidden />
                    {slotLabel(slot.weekday, slot.hour)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-ink-400">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                    Schedule
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
