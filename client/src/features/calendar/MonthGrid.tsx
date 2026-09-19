import { useMemo } from "react";
import type { Post } from "@socmedia/shared";
import { buildMonthGrid, dayKey, postsByDay } from "./calendarUtils";
import { DayCell } from "./DayCell";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface MonthGridProps {
  monthDate: Date;
  posts: Post[];
  onSelectPost: (post: Post, e: React.MouseEvent<HTMLButtonElement>) => void;
  onEmptyDayClick: (date: Date) => void;
}

export function MonthGrid({ monthDate, posts, onSelectPost, onEmptyDayClick }: MonthGridProps) {
  const weeks = useMemo(() => buildMonthGrid(monthDate), [monthDate]);
  const grouped = useMemo(() => postsByDay(posts), [posts]);

  return (
    <div className="card flex flex-1 flex-col overflow-hidden">
      <div className="grid grid-cols-7 border-b border-ink-200 bg-ink-50">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            {label}
          </div>
        ))}
      </div>
      <div className="grid flex-1 overflow-y-auto scrollbar-thin" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((date) => (
              <DayCell
                key={dayKey(date)}
                date={date}
                currentMonth={monthDate}
                posts={grouped.get(dayKey(date)) ?? []}
                onSelectPost={onSelectPost}
                onEmptyClick={onEmptyDayClick}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
