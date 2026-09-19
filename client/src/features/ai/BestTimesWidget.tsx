import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Clock } from "lucide-react";
import { PLATFORM_SPECS, PLATFORMS, type Platform } from "@socmedia/shared";
import { Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { useAppStore } from "@/store/appStore";
import { WEEKDAY_SHORT } from "./aiShared";
import { nextOccurrence } from "./aiUtils";

function slotLabel(weekday: number, hour: number): string {
  return `${WEEKDAY_SHORT[weekday]} ${format(new Date(2020, 0, 1, hour), "h a")}`;
}

export function BestTimesWidget() {
  const [platform, setPlatform] = useState<Platform>("instagram");
  const openComposer = useAppStore((s) => s.openComposer);

  const query = useQuery({
    queryKey: ["ai", "bestTimes", platform],
    queryFn: () => api.ai.bestTimes(platform),
  });

  const top5 = [...(query.data?.slots ?? [])].sort((a, b) => b.score - a.score).slice(0, 5);

  function schedule(weekday: number, hour: number) {
    openComposer(null, { scheduledAt: nextOccurrence(weekday, hour).toISOString() });
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-700">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          Best times to post
        </span>
        <Select
          aria-label="Best times platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          className="h-7 w-auto py-0 text-xs"
        >
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_SPECS[p].name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {query.isLoading && <Skeleton className="h-6 w-full" />}
        {!query.isLoading && top5.length === 0 && <span className="text-xs text-ink-400">No data yet.</span>}
        {top5.map((slot) => (
          <button
            key={`${slot.weekday}-${slot.hour}`}
            type="button"
            onClick={() => schedule(slot.weekday, slot.hour)}
            className="rounded-full border border-ink-200 bg-glass px-2.5 py-1 text-xs font-medium text-ink-700 transition-colors hover:border-brand-300 hover:bg-brand-50"
          >
            {slotLabel(slot.weekday, slot.hour)}
          </button>
        ))}
      </div>
    </div>
  );
}
