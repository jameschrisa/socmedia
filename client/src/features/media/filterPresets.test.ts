import { describe, it, expect } from "vitest";
import { FILTER_PRESETS, adjustmentsForPreset, cssFilterFor, cssTintFor, matchingPreset, NEUTRAL_LOOK } from "./filterPresets";

describe("filter presets", () => {
  it("ships the named looks with unique keys", () => {
    const keys = FILTER_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const name of ["Polaroid", "Y2K Lofi", "Monochrome Noir", "Warm Glow", "Matte"]) {
      expect(FILTER_PRESETS.some((p) => p.name === name)).toBe(true);
    }
  });

  it("expands a look over neutral defaults and round-trips through matching", () => {
    expect(adjustmentsForPreset("none")).toEqual(NEUTRAL_LOOK);
    const noir = adjustmentsForPreset("noir");
    expect(noir.grayscale).toBe(1);
    expect(noir.tint).toBeNull();
    expect(matchingPreset(noir)).toBe("noir");
    expect(matchingPreset({ ...noir, contrast: 1 })).toBeNull();
  });

  it("produces CSS approximations for chips", () => {
    expect(cssFilterFor(adjustmentsForPreset("noir").grayscale ? { grayscale: 1 } : {})).toContain("grayscale(1)");
    expect(cssFilterFor({ sepia: 1 })).toContain("sepia(");
    expect(cssTintFor({ tint: { color: "#ff0000", alpha: 0.2, blend: "screen" } })).toEqual({ background: "rgba(255, 0, 0, 0.2)", mixBlendMode: "screen" });
    expect(cssTintFor({})).toBeNull();
  });
});
