import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { RightRail } from "./RightRail";

describe("RightRail", () => {
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
