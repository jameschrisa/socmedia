import { describe, expect, it } from "vitest";
import { clampPosition, exportRegion, fitStage, frameRect, normalizeRotation } from "./imageMath";

describe("fitStage", () => {
  it("scales a wide image down to fit the box, constrained by width", () => {
    expect(fitStage(4000, 2000, 400, 400)).toEqual({ width: 400, height: 200 });
  });

  it("scales a tall image down to fit the box, constrained by height", () => {
    expect(fitStage(1000, 2000, 400, 400)).toEqual({ width: 200, height: 400 });
  });

  it("falls back to the max box when the image has no size yet", () => {
    expect(fitStage(0, 0, 320, 320)).toEqual({ width: 320, height: 320 });
  });
});

describe("frameRect", () => {
  it("centres a square frame inside a wider stage", () => {
    expect(frameRect(400, 200, 1)).toEqual({ x: 100, y: 0, width: 200, height: 200 });
  });

  it("centres a 16:9 frame inside a square stage", () => {
    const r = frameRect(400, 400, 16 / 9);
    expect(r.width).toBe(400);
    expect(Math.round(r.height)).toBe(225);
    expect(r.x).toBe(0);
  });

  it("centres a 9:16 frame inside a square stage", () => {
    const r = frameRect(400, 400, 9 / 16);
    expect(r.height).toBe(400);
    expect(Math.round(r.width)).toBe(225);
    expect(r.y).toBe(0);
  });
});

describe("clampPosition", () => {
  const frame = { x: 50, y: 50, width: 200, height: 200 };

  it("keeps a larger image covering the frame when dragged too far", () => {
    const pos = clampPosition({ x: 1000, y: 1000 }, { width: 300, height: 300 }, frame);
    expect(pos.x).toBeLessThanOrEqual(frame.x);
    expect(pos.y).toBeLessThanOrEqual(frame.y);
    expect(pos.x + 300).toBeGreaterThanOrEqual(frame.x + frame.width);
    expect(pos.y + 300).toBeGreaterThanOrEqual(frame.y + frame.height);
  });

  it("does not let the image be dragged past the opposite edge", () => {
    const pos = clampPosition({ x: -1000, y: -1000 }, { width: 300, height: 300 }, frame);
    expect(pos.x).toBeGreaterThanOrEqual(frame.x + frame.width - 300);
    expect(pos.y).toBeGreaterThanOrEqual(frame.y + frame.height - 300);
  });

  it("centres an image that is smaller than the frame", () => {
    const pos = clampPosition({ x: 0, y: 0 }, { width: 100, height: 100 }, frame);
    expect(pos.x).toBe(frame.x + 50);
    expect(pos.y).toBe(frame.y + 50);
  });
});

describe("exportRegion", () => {
  it("computes a pixel ratio that upsizes the crop to the format's recommended export size", () => {
    const region = exportRegion({ x: 10, y: 10, width: 200, height: 200 }, "square");
    expect(region.pixelRatio).toBeCloseTo(1080 / 200);
    expect(region.width).toBe(200);
    expect(region.mimeType).toBe("image/jpeg");
    expect(region.quality).toBe(0.92);
  });

  it("uses the frame's own position as the crop origin", () => {
    const region = exportRegion({ x: 42, y: 7, width: 100, height: 100 }, "portrait_9_16");
    expect(region.x).toBe(42);
    expect(region.y).toBe(7);
  });
});

describe("normalizeRotation", () => {
  it("wraps negative degrees into the 0-360 range", () => {
    expect(normalizeRotation(-90)).toBe(270);
  });

  it("wraps degrees greater than 360", () => {
    expect(normalizeRotation(450)).toBe(90);
  });

  it("leaves in-range degrees untouched", () => {
    expect(normalizeRotation(180)).toBe(180);
  });
});
