import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Platform, PlatformConnection, Post } from "@socmedia/shared";
import { mockFetch, renderWithProviders } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { useAiBridge } from "@/features/ai/aiBridge";
import { formatMinutes } from "@/components/ui/TimeScroller";
import { ComposerDrawer } from "./ComposerDrawer";

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

function connection(platform: Platform, overrides: Partial<PlatformConnection> = {}): PlatformConnection {
  return {
    id: `conn-${platform}`,
    orgId: "org1",
    platform,
    label: "",
    enabled: true,
    mode: "sandbox",
    status: "connected",
    displayName: `${platform} page`,
    handle: `@${platform}handle`,
    avatarUrl: null,
    followers: 100,
    credentials: { clientId: "", clientSecret: "", redirectUri: "", accessToken: null, refreshToken: null, tokenExpiresAt: null, scopes: [], extra: {} },
    settings: {
      defaultFormat: "square",
      privacy: "public",
      autoHashtags: false,
      firstCommentHashtags: false,
      allowComments: true,
      allowDuet: true,
      allowStitch: true,
      madeForKids: false,
      category: "22",
      postAsOrganization: false,
      shareToFeed: true,
    },
    lastTest: null,
    connectedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const connections = [connection("tiktok"), connection("youtube"), connection("linkedin"), connection("instagram")];

function baseRoutes() {
  return {
    "GET /api/connections": () => connections,
    "GET /api/media": () => [],
  };
}

beforeEach(() => {
  useAppStore.setState({
    currentOrgId: "org1",
    composerOpen: false,
    composerPostId: null,
    composerDefaults: { scheduledAt: null, mediaIds: [] },
  });
  useAiBridge.setState({ pending: null, context: { brief: "", platforms: [], caption: "" } });
});

describe("ComposerDrawer", () => {
  it("opens with composer defaults and shows the scheduled date/time", () => {
    mockFetch(baseRoutes());
    const scheduledAt = new Date();
    scheduledAt.setHours(15, 30, 0, 0);
    useAppStore.setState({ composerOpen: true, composerPostId: null, composerDefaults: { scheduledAt: scheduledAt.toISOString(), mediaIds: [] } });

    renderWithProviders(<ComposerDrawer />);

    const dateInput = screen.getByDisplayValue(
      `${scheduledAt.getFullYear()}-${String(scheduledAt.getMonth() + 1).padStart(2, "0")}-${String(scheduledAt.getDate()).padStart(2, "0")}`,
    ) as HTMLInputElement;
    expect(dateInput).toBeInTheDocument();
    expect(screen.getByText(new RegExp(formatMinutes(15 * 60 + 30)))).toBeInTheDocument();
  });

  it("shows a format select limited to the selected platform's formats", async () => {
    mockFetch(baseRoutes());
    useAppStore.setState({ composerOpen: true });
    renderWithProviders(<ComposerDrawer />);

    const tiktokCheckbox = await screen.findByLabelText("Include TikTok");
    fireEvent.click(tiktokCheckbox);

    const select = (await screen.findByLabelText("TikTok format")) as HTMLSelectElement;
    const optionLabels = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(optionLabels).toEqual(["Vertical 9:16", "Square 1:1"]);
    expect(optionLabels).not.toContain("Landscape 16:9");
  });

  it("turns the caption counter red once over the Instagram limit", async () => {
    mockFetch(baseRoutes());
    useAppStore.setState({ composerOpen: true });
    renderWithProviders(<ComposerDrawer />);

    fireEvent.click(await screen.findByLabelText("Include Instagram"));
    const textarea = screen.getByPlaceholderText("Write your caption…");
    const longCaption = "x".repeat(2210);
    fireEvent.change(textarea, { target: { value: longCaption } });

    const counter = screen.getByTestId("caption-counter");
    await waitFor(() => expect(counter.className).toContain("text-red-600"));
  });

  it("shows the YouTube title error in the validation panel", async () => {
    mockFetch(baseRoutes());
    useAppStore.setState({ composerOpen: true });
    renderWithProviders(<ComposerDrawer />);

    fireEvent.click(await screen.findByLabelText("Include YouTube"));
    expect(await screen.findByText(/YouTube videos need a title/i)).toBeInTheDocument();
  });

  it("saves a draft via POST /api/posts with title/caption/targets", async () => {
    const { calls } = mockFetch({
      ...baseRoutes(),
      "POST /api/posts": () => ({ id: "post-new", orgId: "org1", title: "My title", caption: "Hello", hashtags: [], mediaIds: [], targets: [{ platform: "instagram", connectionId: "conn-instagram", format: "square", mediaIds: [] }], status: "draft", scheduledAt: null, timezone: "UTC", publishMode: "all", queueSpacingMinutes: 10, labels: [], notes: "", createdAt: "", updatedAt: "", publishedAt: null }),
    });
    useAppStore.setState({ composerOpen: true });
    renderWithProviders(<ComposerDrawer />);

    fireEvent.change(screen.getByPlaceholderText("Give this post a title"), { target: { value: "My title" } });
    fireEvent.change(screen.getByPlaceholderText("Write your caption…"), { target: { value: "Hello" } });
    fireEvent.click(await screen.findByLabelText("Include Instagram"));

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/api/posts") && !c.url.includes("schedule"))).toBe(true));
    const call = calls.find((c) => c.method === "POST" && c.url.endsWith("/api/posts"))!;
    const body = call.body as any;
    expect(body.title).toBe("My title");
    expect(body.caption).toBe("Hello");
    expect(body.targets).toHaveLength(1);
    expect(body.targets[0].platform).toBe("instagram");
  });

  it("schedules a post then calls /schedule with an ISO string", async () => {
    const createdPost: Post = {
      id: "post-new",
      orgId: "org1",
      title: "",
      caption: "Ready",
      hashtags: [],
      mediaIds: [],
      targets: [{ platform: "instagram", connectionId: "conn-instagram", format: "square", mediaIds: ["media-1"] }],
      status: "scheduled",
      scheduledAt: null,
      timezone: "UTC", publishMode: "all", queueSpacingMinutes: 10,
      labels: [],
      notes: "",
      createdAt: "",
      updatedAt: "",
      publishedAt: null,
    };
    const { calls } = mockFetch({
      "GET /api/connections": () => connections,
      "GET /api/media": () => [{ id: "media-1", orgId: "org1", kind: "image", filename: "a.jpg", mimeType: "image/jpeg", size: 10, width: 100, height: 100, durationSeconds: null, url: "/a.jpg", thumbnailUrl: null, tags: [], sourceAssetId: null, format: null, createdAt: "" }],
      "POST /api/posts": () => createdPost,
      "POST /api/posts/:id/schedule": (init) => ({ ...createdPost, scheduledAt: JSON.parse(init!.body as string).scheduledAt }),
    });
    useAppStore.setState({ composerOpen: true, composerDefaults: { scheduledAt: null, mediaIds: ["media-1"] } });
    renderWithProviders(<ComposerDrawer />);

    fireEvent.change(screen.getByPlaceholderText("Write your caption…"), { target: { value: "Ready" } });
    fireEvent.click(await screen.findByLabelText("Include Instagram"));
    fireEvent.click(screen.getByRole("tab", { name: "Schedule" }));

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && /\/schedule$/.test(c.url))).toBe(true));
    const scheduleCall = calls.find((c) => c.method === "POST" && /\/schedule$/.test(c.url))!;
    const body = scheduleCall.body as any;
    expect(typeof body.scheduledAt).toBe("string");
    expect(() => new Date(body.scheduledAt).toISOString()).not.toThrow();
  });

  it("fills the caption textarea when an aiBridge suggestion is pending", async () => {
    mockFetch(baseRoutes());
    useAiBridge.setState({ pending: { kind: "caption", caption: "Hello from AI", createdAt: Date.now() } });
    useAppStore.setState({ composerOpen: true });

    renderWithProviders(<ComposerDrawer />);

    await waitFor(() => expect(screen.getByPlaceholderText("Write your caption…")).toHaveValue("Hello from AI"));
    expect(useAiBridge.getState().pending).toBeNull();
  });

  it("lets one platform target several accounts with select-all and a publish mode", async () => {
    const routes = baseRoutes();
    const multi: PlatformConnection[] = [
      connection("instagram", { id: "conn-instagram", label: "Main" }),
      connection("instagram", { id: "conn-instagram-2", label: "Clinic", handle: "@clinic" }),
      connection("tiktok"),
    ];
    let body: any = null;
    mockFetch({
      ...routes,
      "GET /api/connections": () => multi,
      "GET /api/settings/publishing": () => ({ defaultPublishMode: "queue", queueSpacingMinutes: 25, warnOnDuplicateCaptions: true }),
      "POST /api/posts": (init) => { body = JSON.parse(init!.body as string); return { id: "post-multi", ...body, status: "draft" }; },
    });
    useAppStore.setState({ composerOpen: true });
    const user = userEvent.setup();
    renderWithProviders(<ComposerDrawer />);

    const group = await screen.findByTestId("target-group-instagram");
    expect(within(group).getByText("Instagram: 0/2 accounts")).toBeInTheDocument();
    await user.click(within(group).getByLabelText("Select all Instagram accounts"));
    expect(within(group).getByText("Instagram: 2/2 accounts")).toBeInTheDocument();
    expect(screen.getByLabelText("Include Instagram Main")).toBeChecked();
    expect(screen.getByLabelText("Include Instagram Clinic")).toBeChecked();

    // workspace defaults were applied to the new post
    const modeBox = screen.getByTestId("publish-mode");
    expect(within(modeBox).getByRole("tab", { name: "Queue" })).toHaveAttribute("aria-selected", "true");
    expect((screen.getByLabelText("Queue spacing minutes") as HTMLInputElement).value).toBe("25");
    expect(screen.getByText(/identical caption|same caption/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Write your caption…"), "Hello");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body.targets.map((t: any) => t.connectionId).sort()).toEqual(["conn-instagram", "conn-instagram-2"]);
    expect(body.publishMode).toBe("queue");
    expect(body.queueSpacingMinutes).toBe(25);
  });
});
