import { differenceInCalendarDays, isToday, parseISO } from "date-fns";
import type { Post } from "@socmedia/shared";

/** The four Remote Posting tabs, also addressable by hash (`/remote#phone`, etc). */
export type RemoteTab = "overview" | "phone" | "chat" | "posts";

export const REMOTE_TAB_HASH: Record<RemoteTab, string> = {
  overview: "#overview",
  phone: "#phone",
  chat: "#chat",
  posts: "#posts",
};

export const REMOTE_TAB_FOR_HASH: Record<string, RemoteTab> = {
  "#overview": "overview",
  "#phone": "phone",
  "#chat": "chat",
  "#posts": "posts",
};

/** Where a post came from, based on the label the phone page or the chat pipeline stamps on it. */
export type RemoteSource = "phone" | "chat";

/** "quick" labels come from the phone page, "inbound" from a chat channel. A post could carry both in
 * theory; phone wins since it is the more specific, user-driven source. */
export function remoteSourceOf(post: Pick<Post, "labels">): RemoteSource | null {
  if (post.labels.includes("quick")) return "phone";
  if (post.labels.includes("inbound")) return "chat";
  return null;
}

export function isRemotePost(post: Pick<Post, "labels">): boolean {
  return remoteSourceOf(post) !== null;
}

/** True for a draft that was saved without a caption from the phone or a chat channel (server prefixes
 * the note with "Needs a caption" in that case). */
export function needsCaption(post: Pick<Post, "status" | "notes" | "labels">): boolean {
  return post.status === "draft" && isRemotePost(post) && post.notes.startsWith("Needs a caption");
}

export function isFromToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = parseISO(iso);
  return !Number.isNaN(d.getTime()) && isToday(d);
}

/** True when the timestamp falls within the last `days` calendar days, today included. */
export function isWithinLastDays(iso: string | null | undefined, days: number, now = new Date()): boolean {
  if (!iso) return false;
  const d = parseISO(iso);
  if (Number.isNaN(d.getTime())) return false;
  const diff = differenceInCalendarDays(now, d);
  return diff >= 0 && diff < days;
}

export const REMOTE_SOURCE_LABEL: Record<RemoteSource, string> = {
  phone: "Phone",
  chat: "Chat",
};
