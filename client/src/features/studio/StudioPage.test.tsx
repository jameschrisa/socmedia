import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// jsdom doesn't decode media; make the hidden probe <video> report a controllable duration so
// the client-side over-length check can be exercised deterministically.
let mockVideoDuration = 30;
beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "duration", {
    configurable: true,
    get() { return mockVideoDuration; },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "src", {
    configurable: true,
    set(this: HTMLMediaElement) { queueMicrotask(() => this.onloadedmetadata?.(new Event("loadedmetadata"))); },
    get() { return ""; },
  });
  if (!("createObjectURL" in URL)) (URL as any).createObjectURL = vi.fn();
  if (!("revokeObjectURL" in URL)) (URL as any).revokeObjectURL = vi.fn();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-video");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

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

const videoAsset: MediaAsset = {
  id: "video-1",
  orgId: "org1",
  kind: "video",
  filename: "promo.mp4",
  mimeType: "video/mp4",
  size: 12_000_000,
  width: 1920,
  height: 1080,
  durationSeconds: 125,
  url: "/uploads/org1/promo.mp4",
  thumbnailUrl: "/uploads/org1/promo-thumb.jpg",
  tags: [],
  sourceAssetId: null,
  format: null,
  createdAt: new Date().toISOString(),
};

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
    timezone: "UTC", publishMode: "all", queueSpacingMinutes: 10,
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

  it("shows a video's duration and opens the VideoEditor from its edit action", async () => {
    mockFetch({
      "GET /api/media": () => [videoAsset],
      "GET /api/posts": () => [],
    });
    renderWithProviders(<StudioPage />);
    expect(await screen.findByText("promo.mp4")).toBeInTheDocument();
    expect(screen.getByText(/2:05/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `Edit ${videoAsset.filename}` }));
    expect(await screen.findByTestId("video-frame")).toBeInTheDocument();
  });

  it("refuses an over-length video upload client-side without calling the API", async () => {
    mockVideoDuration = 400;
    let uploaded = false;
    mockFetch({
      "GET /api/media": () => [],
      "GET /api/posts": () => [],
      "POST /api/media": () => { uploaded = true; return videoAsset; },
    });
    const { container } = renderWithProviders(<StudioPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "too-long.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [file] } });

    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Videos must be 5 minutes or shorter", expect.anything()));
    expect(uploaded).toBe(false);
  });
});
