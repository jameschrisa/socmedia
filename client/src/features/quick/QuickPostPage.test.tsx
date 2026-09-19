import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import type { QuickPostPublicInfo, QuickPostResult } from "@socmedia/shared";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { QuickPostPage } from "./QuickPostPage";

function renderAt(route: string) {
  return renderWithProviders(<Routes><Route path="/go/:token" element={<QuickPostPage />} /></Routes>, { route });
}

function makeInfo(overrides: Partial<QuickPostPublicInfo> = {}): QuickPostPublicInfo {
  return {
    label: "Lobby iPad",
    orgName: "Larkspur Health",
    orgLogoUrl: null,
    brandColor: "#2bb8c9",
    targets: [{ connectionId: "conn-1", platform: "instagram", label: "Founder", handle: "@founder" }],
    aiAvailable: true,
    ...overrides,
  };
}

function makePhoto(): File {
  return new File(["fake-bytes"], "photo.jpg", { type: "image/jpeg" });
}

describe("QuickPostPage", () => {
  it("loads the public info and shows the target accounts", async () => {
    mockFetch({ "GET /api/quick/abc123": () => makeInfo() });
    renderAt("/go/abc123");

    expect(await screen.findByText("Larkspur Health")).toBeInTheDocument();
    expect(screen.getByText("Lobby iPad")).toBeInTheDocument();
    expect(screen.getByText("Founder")).toBeInTheDocument();
    expect(screen.getByText("Take a photo")).toBeInTheDocument();
  });

  it("shows a not-found notice for an unknown token", async () => {
    mockFetch({
      "GET /api/quick/bad-token": () => new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } }),
    });
    renderAt("/go/bad-token");

    expect(await screen.findByText("Link no longer valid")).toBeInTheDocument();
  });

  it("refuses to post without a photo", async () => {
    const { calls } = mockFetch({ "GET /api/quick/abc123": () => makeInfo() });
    const user = userEvent.setup();
    renderAt("/go/abc123");

    await screen.findByText("Take a photo");
    await user.click(screen.getByRole("button", { name: "Post now" }));

    expect(await screen.findByText(/Add a photo before posting/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("posts with a photo and caption, then shows live links", async () => {
    const result: QuickPostResult = {
      post: {} as any,
      media: {} as any,
      status: "published",
      caption: "Great day",
      captionSource: "caption",
      links: [{ connectionId: "conn-1", platform: "instagram", label: "Founder", status: "succeeded", url: "https://instagram.com/p/123", error: null }],
    };
    const { calls } = mockFetch({
      "GET /api/quick/abc123": () => makeInfo(),
      "POST /api/quick/abc123": () => result,
    });
    const user = userEvent.setup();
    renderAt("/go/abc123");

    await screen.findByText("Take a photo");
    const fileInput = screen.getByTestId("photo-input") as HTMLInputElement;
    await user.upload(fileInput, makePhoto());
    await user.type(screen.getByLabelText(/Caption/), "Great day");
    await user.click(screen.getByRole("button", { name: "Post now" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/quick/abc123"))).toBe(true));
    expect(await screen.findByText("Posted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open/ })).toHaveAttribute("href", "https://instagram.com/p/123");
  });

  it("shows the needs_caption notice on a 202-style draft response", async () => {
    const result: QuickPostResult = {
      post: {} as any,
      media: {} as any,
      status: "needs_caption",
      caption: "",
      captionSource: "none",
      links: [],
    };
    mockFetch({
      "GET /api/quick/abc123": () => makeInfo(),
      "POST /api/quick/abc123": () => new Response(JSON.stringify(result), { status: 202, headers: { "Content-Type": "application/json" } }),
    });
    const user = userEvent.setup();
    renderAt("/go/abc123");

    await screen.findByText("Take a photo");
    await user.upload(screen.getByTestId("photo-input"), makePhoto());
    // jsdom has no SpeechRecognition, so the client requires a caption in that case; type one
    // to reach the server, which is what actually decides the draft (needs_caption) outcome here.
    await user.type(screen.getByLabelText(/Caption/), "placeholder");
    await user.click(screen.getByRole("button", { name: "Post now" }));

    expect(await screen.findByText(/Saved as a draft without a caption/)).toBeInTheDocument();
  });
});
