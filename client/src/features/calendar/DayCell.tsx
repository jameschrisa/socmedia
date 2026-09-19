import { useDroppable } from "@dnd-kit/core";
import { format, isSameMonth, isToday, startOfDay } from "date-fns";
import { useState } from "react";
import type { Post } from "@socmedia/shared";
import { Modal } from "@/components/ui";
import { cn } from "@/lib/utils";
import { dayKey } from "./calendarUtils";
import { PostChip } from "./PostChip";

const MAX_VISIBLE = 3;

export interface DayCellProps {
  date: Date;
  currentMonth: Date;
  posts: Post[];
  onSelectPost: (post: Post, e: React.MouseEvent<HTMLButtonElement>) => void;
  onEmptyClick: (date: Date) => void;
}

/** One droppable day in the month grid. */
export function DayCell({ date, currentMonth, posts, onSelectPost, onEmptyClick }: DayCellProps) {
  const key = dayKey(date);
  const { setNodeRef, isOver } = useDroppable({ id: `day-${key}` });
  const [showMore, setShowMore] = useState(false);

  const inMonth = isSameMonth(date, currentMonth);
  const today = isToday(date);
  const isPast = startOfDay(date) < startOfDay(new Date());
  const visible = posts.slice(0, MAX_VISIBLE);
  const overflow = posts.length - MAX_VISIBLE;
  const label = format(date, "EEEE, MMMM d, yyyy");

  return (
    <>
      <div
        ref={setNodeRef}
        role="gridcell"
        aria-label={label}
        onClick={(e) => {
          if (e.target === e.currentTarget) onEmptyClick(date);
        }}
        className={cn(
          "flex min-h-[112px] cursor-pointer flex-col gap-1 border-b border-r border-ink-100 p-1.5 text-left last:border-r-0",
          !inMonth && "bg-ink-50",
          isPast && "opacity-60",
          isOver && "bg-brand-50 ring-2 ring-inset ring-brand-400",
        )}
      >
        <span
          className={cn(
            "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
            today ? "bg-brand-500 text-white" : inMonth ? "text-ink-700" : "text-ink-400",
          )}
        >
          {date.getDate()}
        </span>
        <div className="flex flex-col gap-1">
          {visible.map((post) => (
            <PostChip
              key={post.id}
              post={post}
              onClick={(e) => {
                e.stopPropagation();
                onSelectPost(post, e);
              }}
            />
          ))}
        </div>
        {overflow > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowMore(true);
            }}
            className="mt-auto text-left text-[11px] font-medium text-brand-600 hover:underline"
            aria-label={`Show ${overflow} more posts on ${label}`}
          >
            +{overflow} more
          </button>
        )}
      </div>

      <Modal open={showMore} onClose={() => setShowMore(false)} size="sm" title={label}>
        <div className="space-y-1.5">
          {posts.map((post) => (
            <PostChip
              key={post.id}
              post={post}
              dragDisabled
              onClick={(e) => {
                setShowMore(false);
                onSelectPost(post, e);
              }}
            />
          ))}
        </div>
      </Modal>
    </>
  );
}
