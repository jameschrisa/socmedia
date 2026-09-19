import { describe, it, expect, vi } from "vitest";

vi.mock("konva", () => ({ default: { Filters: {} } }));

import { measureTextWidth, rgba } from "./editorText";

describe("editor text helpers", () => {
  it("falls back to a heuristic width without a canvas", () => {
    expect(measureTextWidth("Hello", 20, "Inter", "bold")).toBeCloseTo(5 * 20 * 0.55);
  });
  it("converts hex + alpha to rgba", () => {
    expect(rgba("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
    expect(rgba("#0f0", 1)).toBe("rgba(0, 255, 0, 1)");
    expect(rgba("#000000", 2)).toBe("rgba(0, 0, 0, 1)");
  });
});
