import { describe, it, expect } from "vitest";
import { PLATFORMS, PLATFORM_SPECS, FORMAT_SPECS, commonFormats, cropForFormat, isPlatform, isPostFormat } from "../platforms";

describe("platform specs", () => {
  it("defines all four platforms with a default format they support", () => {
    expect(PLATFORMS).toEqual(["tiktok", "youtube", "linkedin", "instagram"]);
    for (const p of PLATFORMS) {
      const spec = PLATFORM_SPECS[p];
      expect(spec.formats).toContain(spec.defaultFormat);
      expect(spec.oauth.authorizeUrl).toMatch(/^https:\/\//);
      expect(spec.captionMaxLength).toBeGreaterThan(0);
    }
  });

  it("format ratios match their pixel dimensions", () => {
    for (const spec of Object.values(FORMAT_SPECS)) {
      expect(Math.abs(spec.width / spec.height - spec.ratio)).toBeLessThan(0.02);
    }
  });

  it("finds formats common to a set of platforms", () => {
    expect(commonFormats(["tiktok", "instagram"])).toEqual(["square", "portrait_9_16"]);
    expect(commonFormats(["youtube", "linkedin"])).toEqual(["landscape_16_9"]);
    expect(commonFormats(["youtube", "tiktok"])).toEqual(["portrait_9_16"]);
    expect(commonFormats(["tiktok", "linkedin"])).toEqual(["square"]);
    expect(commonFormats([])).toHaveLength(5);
  });

  it("computes centred crops", () => {
    expect(cropForFormat(2000, 1000, "square")).toEqual({ x: 500, y: 0, width: 1000, height: 1000 });
    const v = cropForFormat(1000, 1000, "portrait_9_16");
    expect(v.height).toBe(1000);
    expect(v.width).toBe(563);
    expect(v.x).toBe(219);
    const l = cropForFormat(1000, 1000, "landscape_16_9");
    expect(l.width).toBe(1000);
    expect(l.height).toBe(563);
  });

  it("type guards", () => {
    expect(isPlatform("tiktok")).toBe(true);
    expect(isPlatform("facebook")).toBe(false);
    expect(isPostFormat("square")).toBe(true);
    expect(isPostFormat("circle")).toBe(false);
  });
});
