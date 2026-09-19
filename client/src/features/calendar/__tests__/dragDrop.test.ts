import { describe, expect, it } from "vitest";
import type { MediaAsset, Post } from "@socmedia/shared";
import { handleDrop } from "../dragDrop";

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

const media: MediaAsset[] = [];

describe("handleDrop", () => {
  it("returns none when there is no drop target", () => {
    expect(handleDrop({ activeId: "media-1", overId: null, posts: [], media })).toEqual({ type: "none" });
  });

  it("returns none for an unrecognized over id", () => {
    expect(handleDrop({ activeId: "media-1", overId: "mystery-1", posts: [], media })).toEqual({ type: "none" });
  });

  it("returns none for an unknown active id prefix", () => {
    expect(handleDrop({ activeId: "unknown-1", overId: "day-2026-09-20", posts: [], media })).toEqual({ type: "none" });
  });

  it("opens the schedule popover for media dropped on a day", () => {
    const action = handleDrop({ activeId: "media-abc", overId: "day-2026-09-20", posts: [], media });
    expect(action.type).toBe("open-schedule-for-media");
    if (action.type !== "open-schedule-for-media") throw new Error("wrong type");
    expect(action.mediaId).toBe("abc");
    expect(action.date.getDate()).toBe(20);
    expect(action.hour).toBeUndefined();
  });

  it("opens the schedule popover for media dropped on a week slot, carrying the hour", () => {
    const action = handleDrop({ activeId: "media-abc", overId: "slot-2026-09-20T15", posts: [], media });
    expect(action.type).toBe("open-schedule-for-media");
    if (action.type !== "open-schedule-for-media") throw new Error("wrong type");
    expect(action.hour).toBe(15);
  });

  it("opens the schedule popover for a draft post dropped on a day", () => {
    const draft = makePost({ id: "d1", scheduledAt: null });
    const action = handleDrop({ activeId: "post-d1", overId: "day-2026-09-21", posts: [draft], media });
    expect(action.type).toBe("open-schedule-for-draft");
    if (action.type !== "open-schedule-for-draft") throw new Error("wrong type");
    expect(action.post).toBe(draft);
    expect(action.date.getDate()).toBe(21);
  });

  it("returns none when the dragged post id cannot be found", () => {
    const action = handleDrop({ activeId: "post-missing", overId: "day-2026-09-21", posts: [], media });
    expect(action).toEqual({ type: "none" });
  });

  it("moves a scheduled post between days, preserving time of day", () => {
    const post = makePost({ id: "s1", status: "scheduled", scheduledAt: "2026-09-15T14:30:00.000Z" });
    const action = handleDrop({ activeId: "post-s1", overId: "day-2026-09-22", posts: [post], media });
    expect(action.type).toBe("move-post");
    if (action.type !== "move-post") throw new Error("wrong type");
    const result = new Date(action.scheduledAt);
    const original = new Date(post.scheduledAt!);
    expect(result.getDate()).toBe(22);
    expect(result.getHours()).toBe(original.getHours());
    expect(result.getMinutes()).toBe(30);
  });

  it("applies the target hour and keeps minutes when dropped on a week slot", () => {
    const post = makePost({ id: "s2", status: "scheduled", scheduledAt: "2026-09-15T14:45:00.000Z" });
    const action = handleDrop({ activeId: "post-s2", overId: "slot-2026-09-22T09", posts: [post], media });
    expect(action.type).toBe("move-post");
    if (action.type !== "move-post") throw new Error("wrong type");
    const result = new Date(action.scheduledAt);
    expect(result.getDate()).toBe(22);
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(45);
  });

  it("blocks moving a published post", () => {
    const post = makePost({ id: "pub", status: "published", scheduledAt: "2026-09-15T14:30:00.000Z" });
    const action = handleDrop({ activeId: "post-pub", overId: "day-2026-09-22", posts: [post], media });
    expect(action.type).toBe("blocked");
  });

  it("blocks moving a partially published or publishing post", () => {
    const partial = makePost({ id: "part", status: "partially_published", scheduledAt: "2026-09-15T14:30:00.000Z" });
    const publishing = makePost({ id: "ing", status: "publishing", scheduledAt: "2026-09-15T14:30:00.000Z" });
    expect(handleDrop({ activeId: "post-part", overId: "day-2026-09-22", posts: [partial], media }).type).toBe("blocked");
    expect(handleDrop({ activeId: "post-ing", overId: "day-2026-09-22", posts: [publishing], media }).type).toBe("blocked");
  });
});
