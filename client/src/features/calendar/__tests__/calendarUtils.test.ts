import { describe, expect, it } from "vitest";
import type { Post } from "@socmedia/shared";
import { buildMonthGrid, combineDayAndMinutes, dayKey, keepTimeOfDay, parseDropId, postsByDay, statusColor } from "../calendarUtils";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1",
    orgId: "org1",
    title: "Title",
    caption: "Caption",
    hashtags: [],
    mediaIds: [],
    targets: [],
    status: "scheduled",
    scheduledAt: null,
    timezone: "UTC", publishMode: "all", queueSpacingMinutes: 10,
    labels: [],
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
    ...overrides,
  };
}

describe("buildMonthGrid", () => {
  it("returns full weeks starting on Sunday and ending on Saturday", () => {
    const weeks = buildMonthGrid(new Date(2026, 8, 17)); // September 2026
    const totalDays = weeks.reduce((n, w) => n + w.length, 0);
    expect([35, 42]).toContain(totalDays);
    for (const week of weeks) {
      expect(week).toHaveLength(7);
      expect(week[0]!.getDay()).toBe(0);
      expect(week[6]!.getDay()).toBe(6);
    }
  });

  it("covers the first and last day of the month", () => {
    const weeks = buildMonthGrid(new Date(2026, 1, 10)); // February 2026 (28 days)
    const flat = weeks.flat();
    const hasFirst = flat.some((d) => d.getFullYear() === 2026 && d.getMonth() === 1 && d.getDate() === 1);
    const hasLast = flat.some((d) => d.getFullYear() === 2026 && d.getMonth() === 1 && d.getDate() === 28);
    expect(hasFirst).toBe(true);
    expect(hasLast).toBe(true);
  });

  it("produces 42 cells for a month that spans 6 weeks", () => {
    const weeks = buildMonthGrid(new Date(2026, 7, 15)); // August 2026 starts on a Saturday -> 6 rows
    const totalDays = weeks.reduce((n, w) => n + w.length, 0);
    expect(totalDays).toBe(42);
  });
});

describe("postsByDay", () => {
  it("groups scheduled posts by local calendar day and drops unscheduled ones", () => {
    const posts = [
      makePost({ id: "a", scheduledAt: "2026-09-17T14:00:00.000Z" }),
      makePost({ id: "b", scheduledAt: "2026-09-17T09:00:00.000Z" }),
      makePost({ id: "c", scheduledAt: "2026-09-18T09:00:00.000Z" }),
      makePost({ id: "d", scheduledAt: null }),
    ];
    const grouped = postsByDay(posts);
    const day17 = dayKey(new Date("2026-09-17T14:00:00.000Z"));
    const day18 = dayKey(new Date("2026-09-18T09:00:00.000Z"));
    expect(grouped.get(day17)).toHaveLength(2);
    expect(grouped.get(day18)).toHaveLength(1);
    expect([...grouped.values()].flat().some((p) => p.id === "d")).toBe(false);
  });

  it("sorts posts within a day chronologically", () => {
    const posts = [
      makePost({ id: "late", scheduledAt: "2026-09-17T20:00:00.000Z" }),
      makePost({ id: "early", scheduledAt: "2026-09-17T08:00:00.000Z" }),
    ];
    const grouped = postsByDay(posts);
    const key = dayKey(new Date("2026-09-17T08:00:00.000Z"));
    expect(grouped.get(key)!.map((p) => p.id)).toEqual(["early", "late"]);
  });
});

describe("keepTimeOfDay", () => {
  it("preserves the local hour and minute while moving to a new day", () => {
    const original = new Date(2026, 8, 10, 14, 30, 0, 0).toISOString();
    const newDay = new Date(2026, 8, 20, 0, 0, 0, 0);
    const result = new Date(keepTimeOfDay(original, newDay));
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(8);
    expect(result.getDate()).toBe(20);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(30);
  });
});

describe("parseDropId", () => {
  it("parses a day id", () => {
    const parsed = parseDropId("day-2026-09-17");
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe("day");
    expect(parsed!.date.getFullYear()).toBe(2026);
    expect(parsed!.date.getMonth()).toBe(8);
    expect(parsed!.date.getDate()).toBe(17);
    expect(parsed!.hour).toBeUndefined();
  });

  it("parses a slot id with an hour", () => {
    const parsed = parseDropId("slot-2026-09-17T14");
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe("slot");
    expect(parsed!.hour).toBe(14);
    expect(parsed!.date.getDate()).toBe(17);
  });

  it("returns null for unknown or malformed ids", () => {
    expect(parseDropId("whatever-123")).toBeNull();
    expect(parseDropId("day-not-a-date")).toBeNull();
    expect(parseDropId("slot-2026-09-17")).toBeNull();
  });
});

describe("combineDayAndMinutes", () => {
  it("produces an ISO string at the given local time", () => {
    const day = new Date(2026, 8, 17);
    const iso = combineDayAndMinutes(day, 10 * 60 + 30); // 10:30
    const result = new Date(iso);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(8);
    expect(result.getDate()).toBe(17);
    expect(result.getHours()).toBe(10);
    expect(result.getMinutes()).toBe(30);
  });

  it("does not mutate the original day", () => {
    const day = new Date(2026, 8, 17, 0, 0, 0, 0);
    combineDayAndMinutes(day, 600);
    expect(day.getHours()).toBe(0);
  });
});

describe("statusColor", () => {
  it("returns distinct colors for key statuses", () => {
    expect(statusColor("failed")).not.toBe(statusColor("scheduled"));
    expect(statusColor("needs_approval")).not.toBe(statusColor("draft"));
    expect(statusColor("published")).not.toBe(statusColor("failed"));
  });
});
