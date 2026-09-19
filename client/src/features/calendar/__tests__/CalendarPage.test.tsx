import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { MediaAsset, Organization, Post } from "@socmedia/shared";
import { mockFetch, renderWithProviders } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { CalendarPage } from "../CalendarPage";

function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1",
    orgId: "org1",
    title: "Launch teaser",
    caption: "Check this out #launch",
    hashtags: ["launch"],
    mediaIds: [],
    targets: [{ platform: "instagram", connectionId: "c1", format: "square", mediaIds: [], caption: null, title: null, hashtags: null }],
    status: "scheduled",
    scheduledAt: todayAt(15),
    timezone: "UTC", publishMode: "all", queueSpacingMinutes: 10,
    labels: [],
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
    ...overrides,
  };
}

const orgs: Organization[] = [
  { id: "org1", name: "Acme", slug: "acme", brandColor: "#7C5CFC", timezone: "UTC", createdAt: "2026-01-01T00:00:00.000Z" },
];

beforeEach(() => {
  useAppStore.setState({
    currentOrgId: "org1",
    calendarView: "month",
    composerOpen: false,
    composerPostId: null,
    composerDefaults: { scheduledAt: null, mediaIds: [] },
  });
});

function baseRoutes(overrides: Partial<{ posts: Post[]; media: MediaAsset[] }> = {}) {
  return {
    "GET /api/orgs": () => orgs,
    "GET /api/posts": () => overrides.posts ?? [],
    "GET /api/media": () => overrides.media ?? [],
  };
}

describe("CalendarPage", () => {
  it("renders the month title and day cells with date aria-labels", async () => {
    mockFetch(baseRoutes());
    renderWithProviders(<CalendarPage />);

    const monthLabel = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
    expect(await screen.findByRole("heading", { name: monthLabel })).toBeInTheDocument();
    expect(screen.getAllByRole("gridcell").length).toBeGreaterThanOrEqual(35);
  });

  it("renders a post chip on the correct day and hides it when its platform is filtered out", async () => {
    const post = makePost();
    mockFetch(baseRoutes({ posts: [post] }));
    renderWithProviders(<CalendarPage />);

    const chip = await screen.findByRole("button", { name: /Launch teaser/i });
    const label = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const cell = screen.getByRole("gridcell", { name: label });
    expect(cell).toContainElement(chip);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("platform-filter"));
    expect(screen.getByTestId("platform-filter")).toHaveTextContent("All platforms");
    await user.click(screen.getByRole("option", { name: /Toggle instagram filter/i }));
    expect(screen.getByTestId("platform-filter")).toHaveTextContent("3 of 4 platforms");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Launch teaser/i })).not.toBeInTheDocument());
  });

  it("switches to week view and shows hour labels", async () => {
    mockFetch(baseRoutes());
    renderWithProviders(<CalendarPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Week" }));
    expect(await screen.findByText("6 AM")).toBeInTheDocument();
    expect(screen.getByText("11 PM")).toBeInTheDocument();
  });

  it("shows a post peek with an Edit button when a chip is clicked", async () => {
    const post = makePost();
    mockFetch(baseRoutes({ posts: [post] }));
    renderWithProviders(<CalendarPage />);

    const user = userEvent.setup();
    const chip = await screen.findByRole("button", { name: /Launch teaser/i });
    await user.click(chip);

    expect(await screen.findByRole("button", { name: "Edit post" })).toBeInTheDocument();
  });

  it("opens the schedule popover on an empty day click and calls openComposer with the chosen time", async () => {
    mockFetch(baseRoutes());
    renderWithProviders(<CalendarPage />);

    const label = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const cell = await screen.findByRole("gridcell", { name: label });

    const user = userEvent.setup();
    await user.click(cell);

    expect(await screen.findByTestId("time-scroller")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create post" }));

    await waitFor(() => {
      const iso = useAppStore.getState().composerDefaults.scheduledAt;
      expect(iso).not.toBeNull();
    });
    const iso = useAppStore.getState().composerDefaults.scheduledAt!;
    const d = new Date(iso);
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(0);
    expect(d.getDate()).toBe(new Date().getDate());
  });
});
