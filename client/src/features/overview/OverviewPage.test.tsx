import { addDays, subDays } from "date-fns";
import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnalyticsSummary, Organization, PlatformConnection, Post, PublishJob } from "@socmedia/shared";
import { PLATFORM_SPECS, PLATFORMS } from "@socmedia/shared";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { OverviewPage } from "./OverviewPage";

function makeOrg(): Organization {
  return { id: "org1", name: "Meridian Labs", slug: "meridian-labs", brandColor: "#7C5CFC", timezone: "UTC", logoUrl: null, createdAt: new Date().toISOString() };
}

function makeConnection(platform: (typeof PLATFORMS)[number], overrides: Partial<PlatformConnection> = {}): PlatformConnection {
  const now = new Date().toISOString();
  return {
    id: `${platform}-1`, orgId: "org1", platform, enabled: true, mode: "sandbox", status: "disconnected",
    displayName: "", handle: "", avatarUrl: null, followers: 0,
    credentials: { clientId: "", clientSecret: "", redirectUri: "", accessToken: null, refreshToken: null, tokenExpiresAt: null, scopes: [], extra: {} },
    settings: { defaultFormat: PLATFORM_SPECS[platform].defaultFormat, privacy: "public", autoHashtags: true, firstCommentHashtags: false, allowComments: true, allowDuet: true, allowStitch: true, madeForKids: false, category: "22", postAsOrganization: false, shareToFeed: true },
    lastTest: null, connectedAt: null, createdAt: now, updatedAt: now,
    ...overrides,
  };
}

function makePost(overrides: Partial<Post> = {}): Post {
  const now = new Date().toISOString();
  return {
    id: "post-x", orgId: "org1", title: "Untitled", caption: "", hashtags: [], mediaIds: [], targets: [],
    status: "draft", scheduledAt: null, timezone: "UTC", labels: [], notes: "", createdAt: now, updatedAt: now, publishedAt: null,
    ...overrides,
  };
}

function emptyTotals() {
  return { followers: 0, impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0, engagementRate: 0 };
}

function makeSummary(): AnalyticsSummary {
  const byPlatform = Object.fromEntries(PLATFORMS.map((p) => [p, { ...emptyTotals(), snapshots: 0 }])) as AnalyticsSummary["byPlatform"];
  return {
    range: { from: "2026-08-19", to: "2026-09-17" },
    totals: { ...emptyTotals(), followers: 22000, impressions: 800000, likes: 15000, comments: 1500, shares: 700, saves: 300 },
    byPlatform,
    series: [],
    topPosts: [],
  };
}

function setup() {
  const org = makeOrg();
  const connections = [
    makeConnection("tiktok", { status: "connected", displayName: "Acme", handle: "@acme.tiktok", followers: 12000 }),
    makeConnection("youtube", { status: "disconnected" }),
    makeConnection("linkedin", { status: "connected", displayName: "Acme Co", handle: "acme-co", followers: 4300, mode: "live" }),
    makeConnection("instagram", { status: "disconnected" }),
  ];

  const now = new Date();
  const posts: Post[] = [
    makePost({ id: "post-published", title: "Published post", status: "published", publishedAt: subDays(now, 3).toISOString() }),
    makePost({ id: "post-scheduled-1", title: "Q4 launch teaser", status: "scheduled", scheduledAt: addDays(now, 2).toISOString(), targets: [{ platform: "tiktok", connectionId: "tiktok-1", format: "portrait_9_16", mediaIds: [] }] }),
    makePost({ id: "post-scheduled-2", title: "Behind the scenes", status: "scheduled", scheduledAt: addDays(now, 5).toISOString(), targets: [{ platform: "youtube", connectionId: "youtube-1", format: "landscape_16_9", mediaIds: [] }] }),
    makePost({ id: "post-approval", title: "Needs a look", status: "needs_approval" }),
  ];

  const jobs: PublishJob[] = [
    { id: "job-1", orgId: "org1", postId: "post-published", connectionId: "tiktok-1", platform: "tiktok", status: "succeeded", attempts: 1, externalId: "1", externalUrl: null, error: null, log: [], startedAt: now.toISOString(), finishedAt: now.toISOString(), createdAt: now.toISOString() },
  ];

  const mocked = mockFetch({
    "GET /api/orgs": () => [org],
    "GET /api/connections": () => connections,
    "GET /api/analytics/summary": () => makeSummary(),
    "GET /api/posts": (_init, url) => {
      const u = new URL(url!, "http://test.local");
      const status = u.searchParams.get("status")?.split(",");
      const from = u.searchParams.get("from");
      const to = u.searchParams.get("to");
      return posts.filter((p) => {
        if (status) return status.includes(p.status);
        if (from && to) return !!p.scheduledAt && p.scheduledAt >= from && p.scheduledAt <= to;
        return true;
      });
    },
    "GET /api/jobs": () => jobs,
    "POST /api/posts/:id/approve": (_init, url) => {
      const id = url?.match(/\/posts\/([^/]+)\/approve/)?.[1];
      const post = posts.find((p) => p.id === id)!;
      post.status = "approved";
      return post;
    },
  });

  return { ...mocked, org, connections, posts, jobs };
}

describe("OverviewPage", () => {
  beforeEach(() => {
    useAppStore.setState({ currentOrgId: "org1" });
  });

  it("greets the user with the current org name", async () => {
    setup();
    renderWithProviders(<OverviewPage />);
    expect(await screen.findByText(/Meridian Labs/)).toBeInTheDocument();
  });

  it("renders 4 platform cards with connected handles", async () => {
    setup();
    renderWithProviders(<OverviewPage />);

    expect(await screen.findByText("@acme.tiktok")).toBeInTheDocument();
    expect(screen.getByText("acme-co")).toBeInTheDocument();
    expect(screen.getAllByText("Not connected")).toHaveLength(2);
  });

  it("lists upcoming scheduled posts", async () => {
    setup();
    renderWithProviders(<OverviewPage />);

    expect(await screen.findByText("Q4 launch teaser")).toBeInTheDocument();
    expect(screen.getByText("Behind the scenes")).toBeInTheDocument();
  });

  it("Approve posts to /api/posts/:id/approve", async () => {
    const { calls } = setup();
    const user = userEvent.setup();
    renderWithProviders(<OverviewPage />);

    expect(await screen.findByText("Needs a look")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.url.includes("/posts/post-approval/approve"))).toBe(true);
    });
  });
});
