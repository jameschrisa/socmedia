import { describe, it, expect } from "vitest";
import { validatePost, hasErrors, extractHashtags, composeCaption } from "../validation";
import type { MediaAsset } from "../types";

const img: MediaAsset = { id: "m1", orgId: "o", kind: "image", filename: "a.png", mimeType: "image/png", size: 1, url: "/a.png", tags: [], createdAt: "" };
const longVideo: MediaAsset = { ...img, id: "v1", kind: "video", filename: "v.mp4", mimeType: "video/mp4", durationSeconds: 1200 };

describe("validatePost", () => {
  it("requires at least one target", () => {
    const issues = validatePost({ title: "", caption: "", hashtags: [], mediaIds: [], targets: [], scheduledAt: null });
    expect(hasErrors(issues)).toBe(true);
  });

  it("flags caption overflow per platform", () => {
    const issues = validatePost({
      title: "", caption: "x".repeat(2300), hashtags: [], mediaIds: ["m1"], scheduledAt: null,
      targets: [
        { platform: "instagram", connectionId: "c", format: "square", mediaIds: [] },
        { platform: "linkedin", connectionId: "c", format: "square", mediaIds: [] },
      ],
    }, [img]);
    expect(issues.filter((i) => i.platform === "instagram" && i.level === "error")).toHaveLength(1);
    expect(issues.filter((i) => i.platform === "linkedin")).toHaveLength(0);
  });

  it("requires media and a title for youtube, rejects images on youtube", () => {
    const issues = validatePost({
      title: "", caption: "hi", hashtags: [], mediaIds: ["m1"], scheduledAt: null,
      targets: [{ platform: "youtube", connectionId: "c", format: "landscape_16_9", mediaIds: [] }],
    }, [img]);
    expect(issues.map((i) => i.message)).toEqual(expect.arrayContaining([expect.stringContaining("title"), expect.stringContaining("does not accept image")]));
  });

  it("rejects overlong videos and unsupported formats", () => {
    const issues = validatePost({
      title: "t", caption: "hi", hashtags: [], mediaIds: ["v1"], scheduledAt: null,
      targets: [{ platform: "tiktok", connectionId: "c", format: "landscape_16_9", mediaIds: [] }],
    }, [longVideo]);
    expect(issues.some((i) => i.message.includes("under 10 minutes"))).toBe(true);
    expect(issues.some((i) => i.message.includes("format"))).toBe(true);
  });

  it("warns on hashtag counts and passes a valid post", () => {
    const tags = Array.from({ length: 6 }, (_, i) => `tag${i}`);
    const issues = validatePost({
      title: "t", caption: "hi", hashtags: tags, mediaIds: ["m1"], scheduledAt: new Date().toISOString(),
      targets: [{ platform: "linkedin", connectionId: "c", format: "square", mediaIds: [] }],
    }, [img]);
    expect(hasErrors(issues)).toBe(false);
    expect(issues.filter((i) => i.level === "warning")).toHaveLength(1);
  });
});

describe("hashtags helpers", () => {
  it("extracts unique hashtags", () => {
    expect(extractHashtags("Hello #world #World #tax_tips #world")).toEqual(["world", "World", "tax_tips"]);
  });
  it("composes captions", () => {
    expect(composeCaption("Hi", ["a", "#b"])).toBe("Hi\n\n#a #b");
    expect(composeCaption("Hi ", [])).toBe("Hi");
  });
});

describe("multi-account duplicate caption warnings", () => {
  const base = { title: "t", caption: "Same words", hashtags: ["x"], mediaIds: ["m1"], scheduledAt: null };
  const t = (id: string, caption: string | null = null) => ({ platform: "tiktok" as const, connectionId: id, format: "portrait_9_16" as const, mediaIds: [], caption });
  it("warns when several accounts on one platform get an identical caption at once", () => {
    const issues = validatePost({ ...base, targets: [t("a"), t("b")], publishMode: "all" }, [img]);
    expect(issues.some((i) => i.level === "warning" && /identical caption/.test(i.message))).toBe(true);
  });
  it("softens the warning in queue mode and drops it when captions differ", () => {
    const queued = validatePost({ ...base, targets: [t("a"), t("b")], publishMode: "queue" }, [img]);
    expect(queued.some((i) => /one after another/.test(i.message))).toBe(true);
    const varied = validatePost({ ...base, targets: [t("a"), t("b", "A different take")] }, [img]);
    expect(varied.some((i) => /caption/.test(i.message) && i.level === "warning")).toBe(false);
  });
});
