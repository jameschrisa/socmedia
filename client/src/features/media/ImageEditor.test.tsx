import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { MediaAsset } from "@socmedia/shared";
import { mockFetch, renderWithProviders } from "@/test-utils";
import { waitFor } from "@testing-library/react";
import { useAppStore } from "@/store/appStore";
import { ImageEditor } from "./ImageEditor";

vi.mock("react-konva", async () => {
  const React = await import("react");
  return {
    Stage: React.forwardRef(({ children }: any, ref: any) => <div data-testid="stage" ref={ref}>{children}</div>),
    Layer: ({ children }: any) => <>{children}</>,
    Image: React.forwardRef(() => null),
    Rect: () => null,
    Text: () => null,
    Line: () => null,
    Group: ({ children }: any) => <>{children}</>,
    Transformer: React.forwardRef(() => null),
  };
});

vi.mock("use-image", () => ({ default: () => [undefined, "loading"] }));

vi.mock("konva", () => ({
  default: { Filters: { Brighten: vi.fn(), Contrast: vi.fn(), HSL: vi.fn(), Blur: vi.fn() } },
}));

const asset: MediaAsset = {
  id: "media-1",
  orgId: "org1",
  kind: "image",
  filename: "hero.jpg",
  mimeType: "image/jpeg",
  size: 204800,
  width: 1600,
  height: 1600,
  durationSeconds: null,
  url: "/uploads/org1/hero.jpg",
  thumbnailUrl: "/uploads/org1/hero-thumb.jpg",
  tags: [],
  sourceAssetId: null,
  format: null,
  createdAt: new Date().toISOString(),
};

describe("ImageEditor", () => {
  beforeEach(() => {
    useAppStore.setState({ currentOrgId: "org1" });
    mockFetch({
      "GET /api/orgs": () => [{ id: "org1", name: "Acme", slug: "acme", brandColor: "#7C5CFC", timezone: "UTC", createdAt: new Date().toISOString() }],
    });
  });

  it("renders format preset chips and switching preset changes the frame aspect", () => {
    renderWithProviders(<ImageEditor asset={asset} initialFormat="square" onExport={vi.fn()} onClose={vi.fn()} />);

    const frame = screen.getByTestId("crop-frame");
    expect(frame).toHaveAttribute("data-format", "square");

    fireEvent.click(screen.getByRole("button", { name: "Vertical 9:16" }));
    expect(frame).toHaveAttribute("data-format", "portrait_9_16");

    fireEvent.click(screen.getByRole("button", { name: "Landscape 16:9" }));
    expect(frame).toHaveAttribute("data-format", "landscape_16_9");
  });

  it("restricts preset chips to allowedFormats", () => {
    renderWithProviders(<ImageEditor asset={asset} initialFormat="square" allowedFormats={["square", "portrait_4_5"]} onExport={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Vertical 9:16" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Portrait 4:5" })).toBeInTheDocument();
  });

  it("applies a platform shortcut's default format", () => {
    renderWithProviders(<ImageEditor asset={asset} initialFormat="square" onExport={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /TikTok/i }));
    expect(screen.getByTestId("crop-frame")).toHaveAttribute("data-format", "portrait_9_16");
  });

  it("calls onClose from the cancel button", () => {
    const onClose = vi.fn();
    renderWithProviders(<ImageEditor asset={asset} initialFormat="square" onExport={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("adds a text layer", () => {
    renderWithProviders(<ImageEditor asset={asset} initialFormat="square" onExport={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("No text layers yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add text/i }));
    expect(screen.queryByText("No text layers yet.")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("New text")).toBeInTheDocument();
  });

  it("shows sticker background colour and opacity controls when the background is enabled", () => {
    renderWithProviders(<ImageEditor asset={asset} initialFormat="square" onExport={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add text/i }));
    expect(screen.queryByTestId("sticker-bg-controls")).not.toBeInTheDocument();
    expect(screen.getByText("Text opacity")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/sticker bg/i));
    const controls = screen.getByTestId("sticker-bg-controls");
    expect(controls).toBeInTheDocument();
    const colour = screen.getByLabelText("Sticker background colour") as HTMLInputElement;
    expect(colour.value).toBe("#000000");
    fireEvent.change(colour, { target: { value: "#ff0000" } });
    expect((screen.getByLabelText("Sticker background colour") as HTMLInputElement).value).toBe("#ff0000");
    expect(screen.getByText("Bg opacity")).toBeInTheDocument();
  });

  it("adds an uploaded PNG as a sticker layer with opacity, size and rotate controls, and removes it", async () => {
    renderWithProviders(<ImageEditor asset={asset} initialFormat="square" onExport={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("No overlays yet.")).toBeInTheDocument();
    const input = screen.getByTestId("sticker-file-input") as HTMLInputElement;
    const file = new File([new Uint8Array([137, 80, 78, 71])], "badge.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    const row = await screen.findByTestId("sticker-row", {}, { timeout: 4000 });
    expect(row).toHaveTextContent("badge.png");
    expect(screen.getByText("Opacity")).toBeInTheDocument();
    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(screen.getByText("Rotate")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove sticker" }));
    await waitFor(() => expect(screen.queryByTestId("sticker-row")).not.toBeInTheDocument());
  });

  it("offers the media library as a sticker source", () => {
    renderWithProviders(<ImageEditor asset={asset} initialFormat="square" onExport={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(screen.getByText("Add from library")).toBeInTheDocument();
  });
});
