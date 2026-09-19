import { describe, expect, it } from "vitest";
import { clamp, clampRange, formatTimecode, frameFor, parseTimecode, previewCropStyle, secondsFromPointer } from "./videoMath";

describe("clamp", () => {
  it("keeps values within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });
});

describe("formatTimecode", () => {
  it("formats sub-10s durations with tenths precision", () => {
    expect(formatTimecode(3.456)).toBe("0:03.5");
    expect(formatTimecode(0)).toBe("0:00.0");
    expect(formatTimecode(9.99)).toBe("0:10.0");
  });

  it("formats 10s+ durations as m:ss", () => {
    expect(formatTimecode(10)).toBe("0:10");
    expect(formatTimecode(65)).toBe("1:05");
    expect(formatTimecode(600)).toBe("10:00");
  });

  it("treats negative/NaN input as zero", () => {
    expect(formatTimecode(-4)).toBe("0:00.0");
    expect(formatTimecode(NaN)).toBe("0:00.0");
  });
});

describe("parseTimecode", () => {
  it("parses m:ss and m:ss.s", () => {
    expect(parseTimecode("1:05")).toBe(65);
    expect(parseTimecode("0:03.5")).toBeCloseTo(3.5);
  });

  it("parses a plain seconds value", () => {
    expect(parseTimecode("12.5")).toBe(12.5);
  });

  it("returns null for unparseable input", () => {
    expect(parseTimecode("")).toBeNull();
    expect(parseTimecode("abc")).toBeNull();
    expect(parseTimecode("1:2:3")).toBeNull();
  });
});

describe("clampRange", () => {
  it("keeps start and end within [0, duration]", () => {
    expect(clampRange({ start: -5, end: 200 }, 100)).toEqual({ start: 0, end: 100 });
  });

  it("enforces the max length by pulling end back", () => {
    const r = clampRange({ start: 10, end: 1000 }, 1000, 300, 0.5);
    expect(r.start).toBe(10);
    expect(r.end).toBe(310);
    expect(r.end - r.start).toBe(300);
  });

  it("shrinks the max-length window against the duration boundary", () => {
    const r = clampRange({ start: 900, end: 1000 }, 950, 300, 0.5);
    expect(r.end).toBe(950);
    expect(r.end - r.start).toBeLessThanOrEqual(300);
  });

  it("enforces the min length by pushing end forward", () => {
    const r = clampRange({ start: 10, end: 10.1 }, 100, 300, 0.5);
    expect(r.end - r.start).toBeCloseTo(0.5);
  });

  it("keeps the min length window inside the duration", () => {
    const r = clampRange({ start: 99.8, end: 99.9 }, 100, 300, 0.5);
    expect(r.end).toBe(100);
    expect(r.start).toBe(99.5);
  });

  it("swaps an inverted range defensively", () => {
    const r = clampRange({ start: 50, end: 10 }, 100);
    expect(r.start).toBeLessThanOrEqual(r.end);
  });
});

describe("frameFor", () => {
  it("returns the recommended pixel size for a format", () => {
    expect(frameFor("portrait_9_16")).toEqual({ width: 1080, height: 1920 });
    expect(frameFor("square")).toEqual({ width: 1080, height: 1080 });
  });

  it("returns null for Original (no format)", () => {
    expect(frameFor(null)).toBeNull();
    expect(frameFor(undefined)).toBeNull();
  });
});

describe("previewCropStyle", () => {
  it("covers the target aspect ratio when a format is chosen", () => {
    const style = previewCropStyle(1920, 1080, "portrait_9_16");
    expect(style.objectFit).toBe("cover");
    expect(style.aspectRatio).toBe("1080 / 1920");
  });

  it("contains the source aspect ratio when there is no format", () => {
    const style = previewCropStyle(1920, 1080, null);
    expect(style.objectFit).toBe("contain");
    expect(style.aspectRatio).toBe("1920 / 1080");
  });

  it("falls back to 16:9 when source size is unknown", () => {
    const style = previewCropStyle(0, 0, null);
    expect(style.aspectRatio).toBe("16 / 9");
  });
});

describe("secondsFromPointer", () => {
  it("maps the pointer position across the track to seconds", () => {
    const rect = { left: 100, width: 200 };
    expect(secondsFromPointer(100, rect, 60)).toBe(0);
    expect(secondsFromPointer(200, rect, 60)).toBe(30);
    expect(secondsFromPointer(300, rect, 60)).toBe(60);
  });

  it("clamps outside the track bounds", () => {
    const rect = { left: 100, width: 200 };
    expect(secondsFromPointer(0, rect, 60)).toBe(0);
    expect(secondsFromPointer(1000, rect, 60)).toBe(60);
  });

  it("returns 0 when the track has no width", () => {
    expect(secondsFromPointer(150, { left: 100, width: 0 }, 60)).toBe(0);
  });
});
