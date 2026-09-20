import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { RightRail } from "./RightRail";

function authRoute(role: "owner" | "admin" | "editor" | "viewer" = "editor") {
  return () => ({
    authenticated: true,
    needsSetup: false,
    user: { id: "u1", email: "ada@suprstar.com", name: "Ada Lovelace", role, orgIds: "*", active: true, mustChangePassword: false, createdAt: "", lastLoginAt: null },
  });
}

describe("RightRail", () => {
  it("navigates to /assistant when rail-ai is clicked", async () => {
    mockFetch({ "GET /api/auth/me": authRoute("editor") });
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/" element={<RightRail />} />
        <Route path="/assistant" element={<div data-testid="assistant-landed" />} />
      </Routes>,
      { route: "/" },
    );

    await user.click(await screen.findByTestId("rail-ai"));

    expect(await screen.findByTestId("assistant-landed")).toBeInTheDocument();
  });

  it("hides rail-ai for viewers", async () => {
    mockFetch({ "GET /api/auth/me": authRoute("viewer") });
    renderWithProviders(<RightRail />);
    await screen.findByTestId("rail-docs");
    expect(screen.queryByTestId("rail-ai")).not.toBeInTheDocument();
  });

  it("searches platform docs from the Documentation panel and renders hits", async () => {
    const { calls } = mockFetch({
      "GET /api/docs/platforms/search": () => ({
        hits: [
          {
            platform: "tiktok",
            file: "docs/platforms/tiktok.md",
            topic: "auth",
            heading: "OAuth scopes",
            excerpt: "TikTok requires video.publish and video.upload scopes.",
            score: 0.9,
            sources: ["https://developers.tiktok.com/doc/content-posting-api-get-started"],
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<RightRail />);

    await user.click(screen.getByTestId("rail-docs"));
    await user.type(await screen.findByLabelText("Search platform docs"), "oauth");

    const hit = await screen.findByTestId("platform-docs-hit");
    expect(hit).toHaveTextContent("OAuth scopes");
    expect(hit).toHaveTextContent("tiktok");
    expect(hit).toHaveTextContent("TikTok requires video.publish");

    await waitFor(() => expect(calls.some((c) => c.url.includes("/docs/platforms/search") && c.url.includes("q=oauth"))).toBe(true));
  });

  it("shows a no-matches message when the search returns nothing", async () => {
    mockFetch({ "GET /api/docs/platforms/search": () => ({ hits: [] }) });
    const user = userEvent.setup();
    renderWithProviders(<RightRail />);

    await user.click(screen.getByTestId("rail-docs"));
    await user.type(await screen.findByLabelText("Search platform docs"), "nothing");

    expect(await screen.findByText(/no matches in the platform docs/i)).toBeInTheDocument();
  });
});
