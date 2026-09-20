import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MediaAsset } from "@socmedia/shared";
import { PlatformPreview } from "./PlatformPreview";

function makeImage(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "img-1",
    orgId: "org1",
    kind: "image",
    filename: "photo.jpg",
    mimeType: "image/jpeg",
    size: 1000,
    width: 1080,
    height: 1080,
    durationSeconds: null,
    url: "/uploads/org1/photo.jpg",
    thumbnailUrl: null,
    tags: [],
    sourceAssetId: null,
    format: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeVideo(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return { ...makeImage(overrides), id: "vid-1", kind: "video", filename: "clip.mp4", mimeType: "video/mp4", durationSeconds: 30, ...overrides };
}

describe("PlatformPreview (X)", () => {
  it("renders the display name, handle and caption in the preview-x card", () => {
    render(
      <PlatformPreview platform="x" format="square" title="" caption="Hello from X" media={[]} displayName="Acme" handle="@acme" />,
    );
    const card = screen.getByTestId("preview-x");
    expect(card).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("@acme")).toBeInTheDocument();
    expect(screen.getByText("Hello from X")).toBeInTheDocument();
  });

  it("shows a placeholder-style prompt when the caption is empty", () => {
    render(<PlatformPreview platform="x" format="square" title="" caption="" media={[]} />);
    expect(screen.getByText("What's happening?")).toBeInTheDocument();
  });

  it("shows a 280-char counter that is not red under the limit", () => {
    render(<PlatformPreview platform="x" format="square" title="" caption="Short caption" media={[]} />);
    const counter = screen.getByTestId("preview-x-counter");
    expect(counter).toHaveTextContent("13/280");
    expect(counter.className).not.toContain("text-red-600");
  });

  it("turns the counter red once the caption exceeds 280 characters", () => {
    render(<PlatformPreview platform="x" format="square" title="" caption={"x".repeat(281)} media={[]} />);
    const counter = screen.getByTestId("preview-x-counter");
    expect(counter).toHaveTextContent("281/280");
    expect(counter.className).toContain("text-red-600");
  });

  it("lays out up to 4 images in a grid", () => {
    const images = [makeImage({ id: "img-1" }), makeImage({ id: "img-2" }), makeImage({ id: "img-3" }), makeImage({ id: "img-4" })];
    const { container } = render(<PlatformPreview platform="x" format="square" title="" caption="Carousel" media={images} />);
    expect(container.querySelectorAll("img")).toHaveLength(4);
  });

  it("renders a single video frame instead of an image grid when the media is a video", () => {
    const { container } = render(<PlatformPreview platform="x" format="landscape_16_9" title="" caption="Watch this" media={[makeVideo()]} />);
    expect(container.querySelector("video")).toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });
});
