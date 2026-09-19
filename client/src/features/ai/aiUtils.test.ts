import { describe, expect, it } from "vitest";
import { buildBriefFromIdea, charStatus, nextOccurrence, toneLabel } from "./aiUtils";

describe("toneLabel", () => {
  it("maps known tones to friendly labels", () => {
    expect(toneLabel("professional")).toBe("Professional");
    expect(toneLabel("bold")).toBe("Bold");
    expect(toneLabel("educational")).toBe("Educational");
  });
});

describe("charStatus", () => {
  it("is ok well under the limit", () => {
    expect(charStatus(50, 100)).toBe("ok");
  });

  it("warns near the limit", () => {
    expect(charStatus(95, 100)).toBe("warn");
    expect(charStatus(90, 100)).toBe("warn");
  });

  it("is over past the limit", () => {
    expect(charStatus(101, 100)).toBe("over");
  });
});

describe("buildBriefFromIdea", () => {
  it("combines the title and hook", () => {
    expect(buildBriefFromIdea({ title: "5 Tips", hook: "You won't believe #3" })).toBe("5 Tips: You won't believe #3");
  });
});

describe("nextOccurrence", () => {
  it("lands on the requested weekday and hour, in the future", () => {
    // Wed 2026-09-16 10:00 local
    const now = new Date(2026, 8, 16, 10, 0, 0);
    const result = nextOccurrence(5, 14, now); // next Friday at 2pm
    expect(result.getDay()).toBe(5);
    expect(result.getHours()).toBe(14);
    expect(result.getTime()).toBeGreaterThan(now.getTime());
  });

  it("rolls to next week when the target time today has already passed", () => {
    const now = new Date(2026, 8, 16, 10, 0, 0); // Wednesday, 10am
    const result = nextOccurrence(3, 9, now); // same weekday, earlier hour
    expect(result.getDay()).toBe(3);
    expect(result.getHours()).toBe(9);
    expect(result.getTime()).toBeGreaterThan(now.getTime());
    expect(result.getDate()).toBe(now.getDate() + 7);
  });

  it("uses later today when the target hour has not passed yet", () => {
    const now = new Date(2026, 8, 16, 10, 0, 0); // Wednesday, 10am
    const result = nextOccurrence(3, 18, now); // same weekday, later hour
    expect(result.getDate()).toBe(now.getDate());
    expect(result.getHours()).toBe(18);
    expect(result.getTime()).toBeGreaterThan(now.getTime());
  });
});
