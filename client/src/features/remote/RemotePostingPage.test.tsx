import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InboundMessage, MediaAsset, Post } from "@socmedia/shared";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { RemotePostingPage } from "./RemotePostingPage";

function authRoute(role: "owner" | "admin" | "editor" | "viewer" = "owner") {
  return () => ({
    authenticated: true,
    needsSetup: false,
    user: { id: "u1", email: "ada@suprstar.com", name: "Ada Lovelace", role, orgIds: "*", active: true, mustChangePassword: false, createdAt: "", lastLoginAt: null },
  });
}

const TODAY = new Date().toISOString();
const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "post-1",
    orgId: "org1",
    title: "",
    caption: "",
    hashtags: [],
    mediaIds: [],
    targets: [{ platform: "tiktok", connectionId: "c1", format: "portrait_9_16", mediaIds: [] }],
    status: "draft",
    scheduledAt: null,
    timezone: "UTC",
    publishMode: "all",
    queueSpacingMinutes: 10,
    labels: [],
    notes: "",
    createdAt: TODAY,
    updatedAt: TODAY,
    publishedAt: null,
    ...overrides,
  };
}

function makeMedia(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "media-1",
    orgId: "org1",
    kind: "image",
    filename: "a.jpg",
    mimeType: "image/jpeg",
    size: 10,
    width: 100,
    height: 100,
    durationSeconds: null,
    url: "/a.jpg",
    thumbnailUrl: null,
    tags: ["quick"],
    sourceAssetId: null,
    format: null,
    createdAt: TODAY,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: "msg-1",
    channel: "twilio",
    providerMessageId: "sm1",
    senderId: "+15551234567",
    bindingId: null,
    orgId: "org1",
    userId: "u1",
    text: "hello",
    mediaCount: 0,
    hasAudio: false,
    status: "published",
    postId: null,
    mediaIds: [],
    links: [],
    reply: null,
    repliedBy: null,
    error: null,
    timeline: [],
    receivedAt: TODAY,
    completedAt: null,
    ...overrides,
  };
}

function baseFixtures() {
  const posts: Post[] = [
    makePost({ id: "p-quick-needs-caption", labels: ["quick"], status: "draft", notes: "Needs a caption (submitted from phone)", mediaIds: ["media-1"], createdAt: TODAY }),
    makePost({ id: "p-quick-published", labels: ["quick"], status: "published", caption: "Look at this", createdAt: TODAY }),
    makePost({ id: "p-inbound-failed", labels: ["inbound"], status: "failed", caption: "Oops", createdAt: TODAY, updatedAt: TODAY }),
    makePost({ id: "p-inbound-old", labels: ["inbound"], status: "published", caption: "hi from chat", createdAt: YESTERDAY, updatedAt: YESTERDAY }),
  ];
  const messages: InboundMessage[] = [
    makeMessage({ id: "msg-today-1", receivedAt: TODAY, postId: "p-inbound-failed", status: "failed" }),
    makeMessage({ id: "msg-today-2", receivedAt: TODAY, postId: null, status: "published" }),
    makeMessage({ id: "msg-yesterday", receivedAt: YESTERDAY, postId: "p-inbound-old", status: "published" }),
  ];
  return {
    "GET /api/orgs": () => [{ id: "org1", name: "Acme", slug: "acme", brandColor: "#7C5CFC", timezone: "UTC", logoUrl: null, createdAt: TODAY }],
    "GET /api/connections": () => [],
    "GET /api/posts": () => posts,
    "GET /api/media": () => [makeMedia()],
    "GET /api/quick/tokens": () => [],
    "GET /api/inbound/status": () => ({
      channels: [{ channel: "twilio", configured: true, enabled: true, state: "listening", webhookUrl: "https://x/inbound/twilio", lastEventAt: TODAY, counts: { today: 2, published: 1, failed: 1, pending: 0 } }],
      bindings: 1,
      transcription: { configured: false, provider: "none" as const },
    }),
    "GET /api/inbound/messages": () => messages,
    "GET /api/inbound/channels": () => [],
    "GET /api/inbound/bindings": () => [],
    "GET /api/inbound/transcription": () => ({ provider: "none", configured: false }),
    "GET /api/jobs": () => [],
  };
}

describe("RemotePostingPage", () => {
  it("renders all four tabs and defaults to Overview", async () => {
    useAppStore.setState({ currentOrgId: "org1" });
    mockFetch({ "GET /api/auth/me": authRoute("owner"), ...baseFixtures() });
    renderWithProviders(<RemotePostingPage />);

    const tabs = within(await screen.findByTestId("remote-tabs"));
    expect(tabs.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(tabs.getByRole("tab", { name: "Phone links" })).toBeInTheDocument();
    expect(tabs.getByRole("tab", { name: "Chat channels" })).toBeInTheDocument();
    expect(tabs.getByRole("tab", { name: "Remote posts" })).toBeInTheDocument();
    expect(tabs.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("selects the tab from the URL hash", async () => {
    useAppStore.setState({ currentOrgId: "org1" });
    mockFetch({ "GET /api/auth/me": authRoute("owner"), ...baseFixtures() });
    renderWithProviders(<RemotePostingPage />, { route: "/remote#phone" });

    const tabs = within(await screen.findByTestId("remote-tabs"));
    expect(tabs.getByRole("tab", { name: "Phone links" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("button", { name: "Create link" })).toBeInTheDocument();
  });

  it("computes KPI tiles from posts, messages and tokens", async () => {
    useAppStore.setState({ currentOrgId: "org1" });
    mockFetch({ "GET /api/auth/me": authRoute("owner"), ...baseFixtures() });
    renderWithProviders(<RemotePostingPage />);

    const tiles = await screen.findAllByTestId("stat-tile");
    const tileFor = (label: string) => tiles.find((t) => t.textContent?.includes(label));

    expect(tileFor("Phone posts today")?.textContent).toContain("2");
    expect(tileFor("Needs a caption")?.textContent).toContain("1");
    expect(tileFor("Chat messages today")?.textContent).toContain("2");
    expect(tileFor("Failed today")?.textContent).toContain("1");
  });

  it("saves a caption and publishes from the needs-a-caption queue", async () => {
    useAppStore.setState({ currentOrgId: "org1" });
    const { calls } = mockFetch({
      "GET /api/auth/me": authRoute("owner"),
      ...baseFixtures(),
      "PATCH /api/posts/:id": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        return { ...makePost({ id: "p-quick-needs-caption", labels: ["quick"], status: "draft", notes: "Needs a caption (submitted from phone)" }), ...body };
      },
      "POST /api/posts/:id/publish": () => ({ post: makePost({ id: "p-quick-needs-caption", status: "published" }), jobs: [] }),
    });
    const user = userEvent.setup();
    renderWithProviders(<RemotePostingPage />);

    const row = await screen.findByTestId("needs-caption-row");
    const textarea = within(row).getByLabelText("Caption");
    await user.type(textarea, "A great new caption #launch");
    await user.click(within(row).getByRole("button", { name: "Save caption" }));

    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH" && c.url.includes("/posts/p-quick-needs-caption"));
      expect(patch?.body).toMatchObject({ caption: "A great new caption #launch" });
    });

    await user.click(within(row).getByRole("button", { name: "Publish now" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.url.includes("/posts/p-quick-needs-caption/publish"))).toBe(true);
    });
  });

  it("filters the remote posts table by source", async () => {
    useAppStore.setState({ currentOrgId: "org1" });
    mockFetch({ "GET /api/auth/me": authRoute("owner"), ...baseFixtures() });
    renderWithProviders(<RemotePostingPage />, { route: "/remote#posts" });

    expect(await screen.findAllByTestId("remote-post-row")).toHaveLength(4);

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Phone" }));
    await waitFor(() => expect(screen.getAllByTestId("remote-post-row")).toHaveLength(2));

    await user.click(screen.getByRole("tab", { name: "Chat" }));
    await waitFor(() => expect(screen.getAllByTestId("remote-post-row")).toHaveLength(2));
  });

  it("shows a read-only note for viewers instead of the tabs", async () => {
    useAppStore.setState({ currentOrgId: "org1" });
    mockFetch({ "GET /api/auth/me": authRoute("viewer"), ...baseFixtures() });
    renderWithProviders(<RemotePostingPage />);

    expect(await screen.findByTestId("remote-read-only")).toBeInTheDocument();
    expect(screen.queryByTestId("remote-tabs")).not.toBeInTheDocument();
  });

  it("gates chat channel setup behind manageSettings", async () => {
    useAppStore.setState({ currentOrgId: "org1" });
    mockFetch({ "GET /api/auth/me": authRoute("editor"), ...baseFixtures() });
    renderWithProviders(<RemotePostingPage />, { route: "/remote#chat" });

    expect(await screen.findByTestId("chat-channels-read-only")).toBeInTheDocument();
    expect(screen.queryByTestId("inbound-section")).not.toBeInTheDocument();
  });
});
