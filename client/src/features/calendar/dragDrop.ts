import type { MediaAsset, Post } from "@socmedia/shared";
import { combineDayAndMinutes, keepTimeOfDay, parseDropId } from "./calendarUtils";

/** Statuses that can no longer be rescheduled by dragging. */
const LOCKED_STATUSES = new Set(["published", "partially_published", "publishing"]);

export type DropAction =
  | { type: "open-schedule-for-media"; mediaId: string; date: Date; hour?: number }
  | { type: "open-schedule-for-draft"; post: Post; date: Date; hour?: number }
  | { type: "move-post"; post: Post; scheduledAt: string }
  | { type: "blocked"; reason: string }
  | { type: "none" };

/**
 * Pure decision logic for a dnd-kit `onDragEnd` event. Kept free of React/dnd-kit
 * types so it can be unit tested without simulating real pointer drags.
 */
export function handleDrop(args: {
  activeId: string;
  overId: string | null;
  posts: Post[];
  media: MediaAsset[];
}): DropAction {
  const { activeId, overId, posts } = args;
  if (!overId) return { type: "none" };

  const drop = parseDropId(overId);
  if (!drop) return { type: "none" };

  if (activeId.startsWith("media-")) {
    const mediaId = activeId.slice("media-".length);
    return { type: "open-schedule-for-media", mediaId, date: drop.date, hour: drop.hour };
  }

  if (activeId.startsWith("post-")) {
    const postId = activeId.slice("post-".length);
    const post = posts.find((p) => p.id === postId);
    if (!post) return { type: "none" };

    if (!post.scheduledAt) {
      return { type: "open-schedule-for-draft", post, date: drop.date, hour: drop.hour };
    }

    if (LOCKED_STATUSES.has(post.status)) {
      return { type: "blocked", reason: "Published posts can't be moved by dragging." };
    }

    const scheduledAt =
      drop.kind === "slot"
        ? combineDayAndMinutes(drop.date, drop.hour! * 60 + minutesOf(post.scheduledAt))
        : keepTimeOfDay(post.scheduledAt, drop.date);

    return { type: "move-post", post, scheduledAt };
  }

  return { type: "none" };
}

function minutesOf(iso: string): number {
  return new Date(iso).getMinutes();
}
