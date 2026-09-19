import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { MediaAsset, Post } from "@socmedia/shared";
import { mockFetch, renderWithProviders } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { StudioPage } from "./StudioPage";

vi.mock("react-konva", () => ({
  Stage: ({ children }: any) => <div data-testid="stage">{children}</div>,
  Layer: ({ children }: any) => <>{children}</>,
  Image: () => null,
  Rect: () => null,
  Text: () => null,
  Line: () => null,
  Group: ({ children }: any) => <>{children}</>,
}));
vi.mock("use-image", () => ({ default: () => [undefined, "loading"] }));
vi.mock("konva", () => ({ default: { Filters: { Brighten: vi.fn(), Contrast: vi.fn(), HSL: vi.fn(), Blur: vi.fn(), Grayscale: vi.fn(), Sepia: vi.fn(), Noise: vi.fn() } } }));

const media: MediaAsset[] = [
  {
    id: "media-1",
    orgId: "org1",
    kind: "image",
    filename: "launch-graphic.jpg",
    mimeType: "image/jpeg",
    size: 512000,
    width: 1080,
    height: 1080,
    durationSeconds: null,
    url: "/uploads/org1/launch-graphic.jpg",
    thumbnailUrl: "/uploads/org1/launch-graphic-thumb.jpg",
    tags: ["launch"],
    sourceAssetId: null,
    format: null,
    createdAt: new Date().toISOString(),
  },
];

const posts: Post[] = [
  {
    id: "post-1",
    orgId: "org1",
    title: "Launch day",
    caption: "We're live!",
    hashtags: [],
    mediaIds: ["media-1"],
    targets: [],
    status: "draft",
    scheduledAt: null,
    timezone: "UTC",
    labels: [],
    notes: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    publishedAt: null,
  },
];

describe("StudioPage", () => {
  beforeEach(() => {
    useAppStore.setState({ currentOrgId: "org1", composerOpen: false, composerPostId: null, composerDefaults: { scheduledAt: null, mediaIds: [] } });
  });

  it("renders media cards from GET /api/media", async () => {
    mockFetch({
      "GET /api/media": () => media,
      "GET /api/posts": () => posts,
    });
    renderWithProviders(<StudioPage />);
    expect(await screen.findByText("launch-graphic.jpg")).toBeInTheDocument();
  });

  it("opens the composer with mediaIds when 'Use in post' is clicked", async () => {
    mockFetch({
      "GET /api/media": () => media,
      "GET /api/posts": () => posts,
    });
    renderWithProviders(<StudioPage />);
    const useButton = await screen.findByRole("button", { name: /use in post/i });
    useButton.click();
    await waitFor(() => {
      expect(useAppStore.getState().composerOpen).toBe(true);
      expect(useAppStore.getState().composerDefaults.mediaIds).toEqual(["media-1"]);
    });
  });

  it("shows recent posts with status badges", async () => {
    mockFetch({
      "GET /api/media": () => media,
      "GET /api/posts": () => posts,
    });
    renderWithProviders(<StudioPage />);
    expect(await screen.findByText("Launch day")).toBeInTheDocument();
    expect(screen.getByText("draft")).toBeInTheDocument();
  });

  it("duplicates a creative from the card action", async () => {
    let duplicated: string | null = null;
    mockFetch({
      "GET /api/media": () => media,
      "GET /api/posts": () => posts,
      "POST /api/media/:id/duplicate": (_init, url) => { duplicated = url!.split("/media/")[1]!.split("/")[0]!; return { ...media[0]!, id: "copy-1", sourceAssetId: media[0]!.id }; },
    });
    renderWithProviders(<StudioPage />);
    const btn = await screen.findAllByRole("button", { name: /^Duplicate / });
    fireEvent.click(btn[0]!);
    await waitFor(() => expect(duplicated).toBe(media[0]!.id));
  });
});
