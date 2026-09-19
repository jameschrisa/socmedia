import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { MediaAsset } from "@socmedia/shared";
import { mockFetch, renderWithProviders } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { VideoEditor } from "./VideoEditor";

const asset: MediaAsset = {
  id: "video-1",
  orgId: "org1",
  kind: "video",
  filename: "clip.mp4",
  mimeType: "video/mp4",
  size: 5_000_000,
  width: 1920,
  height: 1080,
  durationSeconds: 60,
  url: "/uploads/org1/clip.mp4",
  thumbnailUrl: "/uploads/org1/clip-thumb.jpg",
  tags: [],
  sourceAssetId: null,
  format: null,
  createdAt: new Date().toISOString(),
};

/** jsdom doesn't decode media; simulate the browser reporting metadata for the <video> element. */
function setMediaMetadata(video: HTMLVideoElement, duration: number, width = 1920, height = 1080) {
  Object.defineProperty(video, "duration", { value: duration, configurable: true });
  Object.defineProperty(video, "videoWidth", { value: width, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: height, configurable: true });
  fireEvent.loadedMetadata(video);
}

describe("VideoEditor", () => {
  beforeEach(() => {
    useAppStore.setState({ currentOrgId: "org1" });
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    HTMLMediaElement.prototype.pause = vi.fn();
    HTMLMediaElement.prototype.load = vi.fn();
  });

  it("renders the source duration and selection summary", () => {
    renderWithProviders(<VideoEditor asset={asset} onClose={vi.fn()} onDone={vi.fn()} />);
    const video = document.querySelector("video") as HTMLVideoElement;
    setMediaMetadata(video, 60);
    expect(screen.getByTestId("playhead-time")).toHaveTextContent("0:00.0 / 1:00");
    expect(screen.getByTestId("clip-summary")).toHaveTextContent("Source duration: 1:00");
    expect(screen.getByTestId("selection-length")).toHaveTextContent("Selected: 1:00");
  });

  it("updates the frame's data-format attribute when a format chip is chosen", () => {
    renderWithProviders(<VideoEditor asset={asset} onClose={vi.fn()} onDone={vi.fn()} />);
    const frame = screen.getByTestId("video-frame");
    expect(frame).toHaveAttribute("data-format", "original");

    fireEvent.click(screen.getByRole("button", { name: "Vertical 9:16" }));
    expect(frame).toHaveAttribute("data-format", "portrait_9_16");

    fireEvent.click(screen.getByRole("button", { name: "Landscape 16:9" }));
    expect(frame).toHaveAttribute("data-format", "landscape_16_9");

    fireEvent.click(screen.getByRole("button", { name: "Original" }));
    expect(frame).toHaveAttribute("data-format", "original");
  });

  it("posts start, end, format and mode 'new' to /media/:id/clip and calls onDone", async () => {
    const created: MediaAsset = { ...asset, id: "clip-1", sourceAssetId: asset.id, tags: ["clip"], durationSeconds: 20, format: "portrait_9_16" };
    const { calls } = mockFetch({ "POST /api/media/:id/clip": () => created });
    const onDone = vi.fn();
    renderWithProviders(<VideoEditor asset={asset} onClose={vi.fn()} onDone={onDone} />);
    const video = document.querySelector("video") as HTMLVideoElement;
    setMediaMetadata(video, 60);

    fireEvent.click(screen.getByRole("button", { name: "Vertical 9:16" }));
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "0:05" } });
    fireEvent.blur(screen.getByLabelText("Start time"));
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "0:25" } });
    fireEvent.blur(screen.getByLabelText("End time"));

    fireEvent.click(screen.getByTestId("video-editor-submit"));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(created));
    const call = calls.find((c) => c.method === "POST" && c.url.includes("/media/video-1/clip"));
    expect(call?.body).toEqual({ start: 5, end: 25, format: "portrait_9_16", mode: "new", muted: false });
  });

  it("sends mode 'replace' and labels the button 'Replace video' when replacing the original", async () => {
    const replaced: MediaAsset = { ...asset, durationSeconds: 20 };
    const { calls } = mockFetch({ "POST /api/media/:id/clip": () => replaced });
    const onDone = vi.fn();
    renderWithProviders(<VideoEditor asset={asset} onClose={vi.fn()} onDone={onDone} />);
    const video = document.querySelector("video") as HTMLVideoElement;
    setMediaMetadata(video, 60);

    fireEvent.click(screen.getByRole("tab", { name: "Replace original" }));
    expect(screen.getByTestId("video-editor-submit")).toHaveTextContent("Replace video");

    fireEvent.click(screen.getByTestId("video-editor-submit"));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(replaced));
    const call = calls.find((c) => c.method === "POST" && c.url.includes("/clip"));
    expect((call?.body as any).mode).toBe("replace");
  });

  it("clamps a selection longer than 5 minutes", () => {
    const longAsset: MediaAsset = { ...asset, durationSeconds: 400 };
    renderWithProviders(<VideoEditor asset={longAsset} onClose={vi.fn()} onDone={vi.fn()} />);
    const video = document.querySelector("video") as HTMLVideoElement;
    setMediaMetadata(video, 400);

    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "6:40" } });
    fireEvent.blur(screen.getByLabelText("End time"));

    expect(screen.getByTestId("selection-length")).toHaveTextContent("Selected: 5:00");
    expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe("5:00");
  });

  it("shows an inline error and toasts when the clip request fails", async () => {
    mockFetch({ "POST /api/media/:id/clip": () => new Response(JSON.stringify({ error: "Clips must be at least half a second" }), { status: 400, headers: { "Content-Type": "application/json" } }) });
    renderWithProviders(<VideoEditor asset={asset} onClose={vi.fn()} onDone={vi.fn()} />);
    const video = document.querySelector("video") as HTMLVideoElement;
    setMediaMetadata(video, 60);

    fireEvent.click(screen.getByTestId("video-editor-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Clips must be at least half a second");
  });

  it("calls onClose from the cancel button", () => {
    const onClose = vi.fn();
    renderWithProviders(<VideoEditor asset={asset} onClose={onClose} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
