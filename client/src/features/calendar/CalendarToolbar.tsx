import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Platform } from "@socmedia/shared";
import { Button, SegmentedTabs, StatusBadge } from "@/components/ui";
import { PlatformFilterDropdown } from "./PlatformFilterDropdown";
import type { ViewMode } from "@/store/appStore";

const STATUS_LEGEND = ["scheduled", "needs_approval", "published", "failed"];

export interface CalendarToolbarProps {
  title: string;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  activePlatforms: Set<Platform>;
  onTogglePlatform: (p: Platform) => void;
  onSetAllPlatforms: (all: boolean) => void;
  onNewPost: () => void;
}

export function CalendarToolbar({
  title,
  view,
  onViewChange,
  onPrev,
  onNext,
  onToday,
  activePlatforms,
  onTogglePlatform,
  onSetAllPlatforms,
  onNewPost,
}: CalendarToolbarProps) {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div className="flex items-center gap-2">
        <h1 className="min-w-[160px] text-lg font-semibold text-ink-900">{title}</h1>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" aria-label="Previous period" onClick={onPrev}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="outline" size="sm" aria-label="Jump to today" onClick={onToday}>
            Today
          </Button>
          <Button variant="ghost" size="sm" aria-label="Next period" onClick={onNext}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedTabs
          items={[
            { id: "month", label: "Month" },
            { id: "week", label: "Week" },
          ]}
          value={view}
          onChange={onViewChange}
        />

        <PlatformFilterDropdown active={activePlatforms} onToggle={onTogglePlatform} onSetAll={onSetAllPlatforms} />

        <div className="hidden items-center gap-2 lg:flex" aria-label="Status legend">
          {STATUS_LEGEND.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>

        <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={onNewPost} aria-label="Create new post">
          New post
        </Button>
      </div>
    </div>
  );
}
