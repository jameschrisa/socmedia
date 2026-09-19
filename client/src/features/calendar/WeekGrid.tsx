import { useDroppable } from "@dnd-kit/core";
import { addDays, format, isToday } from "date-fns";
import type { Post } from "@socmedia/shared";
import { cn } from "@/lib/utils";
import { dayKey } from "./calendarUtils";
import { PostChip } from "./PostChip";

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6am .. 11pm
const ROW_H = 60;

function hourLabel(hour: number): string {
  return format(new Date(2000, 0, 1, hour), "h a");
}

function WeekSlot({ date, hour }: { date: Date; hour: number }) {
  const id = `slot-${dayKey(date)}T${String(hour).padStart(2, "0")}`;
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={`${format(date, "EEEE, MMMM d")} at ${hourLabel(hour)}`}
      className={cn("border-b border-ink-100", isOver && "bg-brand-50 ring-1 ring-inset ring-brand-300")}
      style={{ height: ROW_H }}
    />
  );
}

export interface WeekGridProps {
  weekStart: Date;
  posts: Post[];
  onSelectPost: (post: Post, e: React.MouseEvent<HTMLButtonElement>) => void;
  onEmptySlotClick: (date: Date, hour: number) => void;
}

export function WeekGrid({ weekStart, posts, onSelectPost, onEmptySlotClick }: WeekGridProps) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const byDay = new Map<string, Post[]>();
  for (const post of posts) {
    if (!post.scheduledAt) continue;
    const key = dayKey(new Date(post.scheduledAt));
    const bucket = byDay.get(key);
    if (bucket) bucket.push(post);
    else byDay.set(key, [post]);
  }

  return (
    <div className="card flex flex-1 flex-col overflow-hidden">
      <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-ink-200 bg-glass">
        <div />
        {days.map((d) => (
          <div key={dayKey(d)} className="border-l border-ink-100 px-2 py-2 text-center">
            <div className="text-[11px] uppercase text-ink-400">{format(d, "EEE")}</div>
            <div
              className={cn(
                "mx-auto mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                isToday(d) ? "bg-brand-500 text-white" : "text-ink-700",
              )}
            >
              {format(d, "d")}
            </div>
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="grid grid-cols-[56px_repeat(7,1fr)]">
          <div>
            {HOURS.map((h) => (
              <div key={h} className="pr-2 text-right text-[11px] text-ink-400" style={{ height: ROW_H }}>
                {hourLabel(h)}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const dayPosts = byDay.get(dayKey(d)) ?? [];
            return (
              <div
                key={dayKey(d)}
                className="relative border-l border-ink-100"
                onClick={(e) => {
                  if (e.target === e.currentTarget) onEmptySlotClick(d, 9);
                }}
              >
                {HOURS.map((h) => (
                  <WeekSlot key={h} date={d} hour={h} />
                ))}
                <div className="pointer-events-none absolute inset-0 px-0.5">
                  {dayPosts.map((post) => {
                    const dt = new Date(post.scheduledAt!);
                    const hour = dt.getHours();
                    const minute = dt.getMinutes();
                    if (hour < HOURS[0]!) return null;
                    const top = (hour - HOURS[0]!) * ROW_H + (minute / 60) * ROW_H;
                    return (
                      <div key={post.id} className="pointer-events-auto absolute left-0.5 right-0.5" style={{ top }}>
                        <PostChip post={post} compact onClick={(e) => onSelectPost(post, e)} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
