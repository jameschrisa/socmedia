import { describe, it, expect } from "vitest";
import { matchingCommands, splitLinkify, matchesTextFilter, reconnectDelay } from "./consoleUtils";

describe("consoleUtils", () => {
  it("matches builtin commands by prefix", () => {
    expect(matchingCommands("/p").map((c) => c.command)).toEqual(["/publish", "/posts"].sort());
    expect(matchingCommands("/publish").map((c) => c.command)).toEqual(["/publish"]);
    expect(matchingCommands("hello")).toEqual([]);
    expect(matchingCommands("")).toEqual([]);
  });

  it("splits a line into text and URL segments", () => {
    const parts = splitLinkify("Published to TikTok → https://tiktok.com/@a/video/1 done");
    expect(parts).toEqual([
      { text: "Published to TikTok → ", isUrl: false },
      { text: "https://tiktok.com/@a/video/1", isUrl: true },
      { text: " done", isUrl: false },
    ]);
  });

  it("returns the whole line unsplit when there is no URL", () => {
    expect(splitLinkify("no links here")).toEqual([{ text: "no links here", isUrl: false }]);
  });

  it("matches text filters case-insensitively, and treats blank as match-all", () => {
    expect(matchesTextFilter("Published to TikTok", "tiktok")).toBe(true);
    expect(matchesTextFilter("Published to TikTok", "youtube")).toBe(false);
    expect(matchesTextFilter("Published to TikTok", "")).toBe(true);
    expect(matchesTextFilter("Published to TikTok", "   ")).toBe(true);
  });

  it("caps the reconnect backoff at 8 seconds", () => {
    expect(reconnectDelay(0)).toBe(1000);
    expect(reconnectDelay(1)).toBe(2000);
    expect(reconnectDelay(2)).toBe(4000);
    expect(reconnectDelay(3)).toBe(8000);
    expect(reconnectDelay(10)).toBe(8000);
  });
});
