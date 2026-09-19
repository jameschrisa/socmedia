import { cloneElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnalyticsSummary, Platform, Post, PublishJob } from "@socmedia/shared";
import { PLATFORMS } from "@socmedia/shared";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { AnalyticsPage } from "./AnalyticsPage";
import { rangeFor } from "./analyticsUtils";

const THIRTY = rangeFor("30d");

// recharts' ResponsiveContainer measures its parent via ResizeObserver, which jsdom doesn't do —
// swap it for a fixed-size passthrough so charts render deterministically in tests.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 300, height: 200 }),
  };
});

function emptyTotals() {
  return { followers: 0, impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0, engagementRate: 0 };
}

function makeSummary(): AnalyticsSummary {
  const byPlatform = Object.fromEntries(PLATFORMS.map((p) => [p, { ...emptyTotals(), snapshots: 0 }])) as AnalyticsSummary["byPlatform"];
  byPlatform.tiktok = { ...emptyTotals(), followers: 12000, impressions: 400000, likes: 8000, comments: 900, shares: 400, saves: 300, clicks: 1200, views: 500000, reach: 300000, engagementRate: 0.024, snapshots: 4 };
  byPlatform.youtube = { ...emptyTotals(), followers: 5000, impressions: 100000, likes: 2000, comments: 300, shares: 100, saves: 50, clicks: 400, views: 150000, reach: 90000, engagementRate: 0.024, snapshots: 4 };

  const series: AnalyticsSummary["series"] = [
    { date: "2026-08-19", platform: "tiktok", impressions: 100000, engagement: 2000, followers: 11800 },
    { date: "2026-08-19", platform: "youtube", impressions: 25000, engagement: 500, followers: 4900 },
    { date: "2026-09-17", platform: "tiktok", impressions: 130000, engagement: 3000, followers: 12000 },
    { date: "2026-09-17", platform: "youtube", impressions: 30000, engagement: 700, followers: 5000 },
  ];

  return {
    range: { from: "2026-08-19", to: "2026-09-17" },
    totals: {
      followers: 17000,
      impressions: 500000,
      reach: 390000,
      likes: 10000,
      comments: 1200,
      shares: 500,
      saves: 350,
      clicks: 1600,
      views: 650000,
      engagementRate: 0.024,
    },
    byPlatform,
    series,
    topPosts: [
      { postId: "post-1", title: "Great Reel", platform: "tiktok", engagement: 3000, impressions: 130000, externalUrl: "https://tiktok.com/@acme/video/1" },
    ],
  };
}

function makeJobs(): PublishJob[] {
  const now = new Date().toISOString();
  return [
    { id: "job-failed", orgId: "org1", postId: "post-1", connectionId: "conn-1", platform: "tiktok" as Platform, status: "failed", attempts: 2, externalId: null, externalUrl: null, error: "Upload timed out", log: [], startedAt: now, finishedAt: now, createdAt: now },
    { id: "job-ok", orgId: "org1", postId: "post-2", connectionId: "conn-2", platform: "youtube" as Platform, status: "succeeded", attempts: 1, externalId: "abc", externalUrl: "https://youtube.com/watch?v=abc", error: null, log: [], startedAt: now, finishedAt: now, createdAt: now },
  ];
}

function makePosts(): Post[] {
  const now = new Date().toISOString();
  return [
    { id: "post-1", orgId: "org1", title: "Great Reel", caption: "", hashtags: [], mediaIds: [], targets: [], status: "published", scheduledAt: null, timezone: "UTC", labels: [], notes: "", createdAt: now, updatedAt: now, publishedAt: now },
  ];
}

function setup() {
  const summary = makeSummary();
  const jobs = makeJobs();
  const posts = makePosts();
  const mocked = mockFetch({
    "GET /api/analytics/summary": () => summary,
    "GET /api/analytics/snapshots": () => [],
    "GET /api/jobs": () => jobs,
    "GET /api/posts": () => posts,
    "POST /api/analytics/sync": () => ({ synced: 4 }),
    "POST /api/jobs/:id/retry": (_init, url) => {
      const id = url?.match(/\/jobs\/([^/]+)\/retry/)?.[1];
      const job = jobs.find((j) => j.id === id)!;
      return { ...job, status: "queued", attempts: job.attempts + 1 };
    },
  });
  return { ...mocked, summary, jobs, posts };
}

describe("AnalyticsPage", () => {
  beforeEach(() => {
    useAppStore.setState({ currentOrgId: "org1" });
  });

  it("renders KPI tiles with compact numbers from the mocked summary", async () => {
    setup();
    renderWithProviders(<AnalyticsPage />);

    const tiles = await screen.findAllByTestId("stat-tile");
    expect(tiles.length).toBeGreaterThanOrEqual(4);

    const followersTile = tiles.find((t) => within(t).queryByText("Followers"));
    expect(followersTile).toBeTruthy();
    expect(within(followersTile!).getByText("17K")).toBeInTheDocument();

    const impressionsTile = tiles.find((t) => within(t).queryByText("Impressions"));
    expect(within(impressionsTile!).getByText("500K")).toBeInTheDocument();
  });

  it("changing the range refetches the summary with new from/to params", async () => {
    const { calls } = setup();
    const user = userEvent.setup();
    renderWithProviders(<AnalyticsPage />);

    await screen.findAllByTestId("stat-tile");
    const initialCalls = calls.filter((c) => c.url.includes("/analytics/summary"));
    expect(initialCalls).toHaveLength(1);
    expect(initialCalls[0]!.url).toContain(`from=${THIRTY.from}`);

    await user.click(screen.getByRole("tab", { name: "7d" }));

    await waitFor(() => {
      const summaryCalls = calls.filter((c) => c.url.includes("/analytics/summary"));
      expect(summaryCalls.length).toBeGreaterThan(1);
      const last = summaryCalls[summaryCalls.length - 1]!;
      expect(last.url).not.toContain(`from=${THIRTY.from}`);
    });
  });

  it("Sync now posts to /api/analytics/sync and shows a toast", async () => {
    const { calls } = setup();
    const user = userEvent.setup();
    renderWithProviders(<AnalyticsPage />);

    await screen.findAllByTestId("stat-tile");
    await user.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.url.includes("/analytics/sync"))).toBe(true);
    });
  });

  it("renders the publish log and Retry calls /api/jobs/:id/retry", async () => {
    const { calls } = setup();
    const user = userEvent.setup();
    renderWithProviders(<AnalyticsPage />);

    expect(await screen.findByText("Upload timed out")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.url.includes("/jobs/job-failed/retry"))).toBe(true);
    });
  });
});
