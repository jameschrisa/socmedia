import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PLATFORMS, PLATFORM_SPECS } from "@socmedia/shared";
import { PlatformGlyph, PlatformIcon } from "./PlatformIcon";

describe("PlatformIcon", () => {
  it("renders a badge for every platform, including X", () => {
    expect(PLATFORMS).toContain("x");
    for (const platform of PLATFORMS) {
      const { container } = render(<PlatformIcon platform={platform} />);
      expect(container.querySelector("svg")).toBeInTheDocument();
    }
  });

  it("renders X as a black tile with a white glyph, matching TikTok's treatment", () => {
    const { container: xContainer } = render(<PlatformIcon platform="x" />);
    const xBadge = xContainer.querySelector("span") as HTMLElement;
    expect(xBadge.style.background).toBe("rgb(0, 0, 0)");
    expect(xBadge.querySelector("svg")?.getAttribute("style")).toContain("color: rgb(255, 255, 255)");

    const { container: tiktokContainer } = render(<PlatformIcon platform="tiktok" />);
    const tiktokBadge = tiktokContainer.querySelector("span") as HTMLElement;
    expect(tiktokBadge.style.background).toBe("rgb(1, 1, 1)");
  });

  it("gives X its own title and glyph path distinct from the other platforms", () => {
    const { container } = render(<PlatformIcon platform="x" />);
    expect(container.querySelector("span")).toHaveAttribute("title", "X");
    const path = container.querySelector("path")?.getAttribute("d");
    expect(path).toContain("18.244 2.25h3.308");
  });

  it("PlatformGlyph renders X in its own brand colour via currentColor", () => {
    const { container } = render(<PlatformGlyph platform="x" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("style")).toContain("color: rgb(0, 0, 0)");
  });
});
