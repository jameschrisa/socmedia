import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import type { Post, PostStatus } from "@socmedia/shared";

/** yyyy-MM-dd key format used to group posts by local calendar day. */
export const DAY_KEY_FORMAT = "yyyy-MM-dd";

export function dayKey(d: Date): string {
  return format(d, DAY_KEY_FORMAT);
}

/**
 * Builds the visible month grid: full weeks (Sun-Sat) from the start of the
 * week containing the 1st of the month through the end of the week containing
 * the last day of the month. Always 35 or 42 cells (5 or 6 full weeks).
 */
export function buildMonthGrid(date: Date): Date[][] {
  const start = startOfWeek(startOfMonth(date));
  const end = endOfWeek(endOfMonth(date));

  const days: Date[] = [];
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) {
    days.push(cur);
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

/** Groups scheduled posts by local calendar day (yyyy-MM-dd). Unscheduled posts are omitted. */
export function postsByDay(posts: Post[]): Map<string, Post[]> {
  const map = new Map<string, Post[]>();
  for (const post of posts) {
    if (!post.scheduledAt) continue;
    const key = dayKey(new Date(post.scheduledAt));
    const bucket = map.get(key);
    if (bucket) bucket.push(post);
    else map.set(key, [post]);
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : a.scheduledAt! > b.scheduledAt! ? 1 : 0));
  }
  return map;
}

/** Combines a calendar day with minutes-since-midnight (local time) into an ISO string. */
export function combineDayAndMinutes(day: Date, minutes: number): string {
  const d = new Date(day);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.toISOString();
}

export interface ParsedDropId {
  kind: "day" | "slot";
  date: Date;
  hour?: number;
}

/** Parses droppable ids of the form `day-YYYY-MM-DD` or `slot-YYYY-MM-DDTHH`. */
export function parseDropId(id: string): ParsedDropId | null {
  if (id.startsWith("day-")) {
    const date = parseLocalDateString(id.slice("day-".length));
    return date ? { kind: "day", date } : null;
  }
  if (id.startsWith("slot-")) {
    const rest = id.slice("slot-".length);
    const [dateStr, hourStr] = rest.split("T");
    const date = dateStr ? parseLocalDateString(dateStr) : null;
    const hour = Number(hourStr);
    if (!date || !hourStr || Number.isNaN(hour)) return null;
    return { kind: "slot", date, hour };
  }
  return null;
}

function parseLocalDateString(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

/** Moves an ISO timestamp to a new calendar day while preserving its local hour/minute. */
export function keepTimeOfDay(originalIso: string, newDay: Date): string {
  const original = new Date(originalIso);
  const next = new Date(newDay);
  next.setHours(original.getHours(), original.getMinutes(), original.getSeconds(), 0);
  return next.toISOString();
}

/** Left-border accent colour for a post chip, matching the app's status palette. */
export function statusColor(status: PostStatus): string {
  switch (status) {
    case "failed":
      return "#ff3b4e";
    case "needs_approval":
      return "#e89a45";
    case "partially_published":
      return "#e89a45";
    case "published":
      return "#6fd3a5";
    case "publishing":
    case "approved":
      return "#59d8e6";
    case "scheduled":
      return "#e0524e";
    case "draft":
    default:
      return "#7a7987";
  }
}
