import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { format, parseISO } from "date-fns";
import type { Post } from "@socmedia/shared";
import { PlatformIcon } from "@/components/ui";
import { cn } from "@/lib/utils";
import { statusColor } from "./calendarUtils";

export interface PostChipProps {
  post: Post;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  compact?: boolean;
  dragDisabled?: boolean;
  className?: string;
}

/** A single scheduled post rendered inside a day cell or week slot. Draggable to reschedule. */
export function PostChip({ post, onClick, compact, dragDisabled, className }: PostChipProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `post-${post.id}`,
    disabled: dragDisabled,
    data: { kind: "post", post },
  });

  const label = post.title.trim() || post.caption.trim() || "Untitled post";
  const time = post.scheduledAt ? format(parseISO(post.scheduledAt), "h:mm a") : null;
  const statusLabel = post.status.replace(/_/g, " ");

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={onClick}
      style={{
        borderLeftColor: statusColor(post.status),
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
      }}
      className={cn(
        "w-full cursor-grab rounded-md border-l-[3px] bg-glass px-1.5 py-1 text-left shadow-sm ring-1 ring-ink-100 transition hover:ring-ink-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200",
        compact ? "text-[11px]" : "text-xs",
        className,
      )}
      aria-label={`${label}${time ? `, ${time}` : ""}, status ${statusLabel}`}
    >
      <div className="flex items-center gap-1">
        {post.targets.slice(0, 4).map((t) => (
          <PlatformIcon key={t.platform} platform={t.platform} size={14} />
        ))}
        {time && <span className="ml-auto shrink-0 text-[10px] font-medium tabular-nums text-ink-500">{time}</span>}
      </div>
      <div className="truncate font-medium text-ink-800">{label}</div>
    </button>
  );
}
