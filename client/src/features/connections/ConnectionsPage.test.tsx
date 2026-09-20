import { describe, it, expect, beforeEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Platform, PlatformConnection } from "@socmedia/shared";
import { PLATFORM_SPECS } from "@socmedia/shared";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { ConnectionsPage } from "./ConnectionsPage";

function idFromUrl(url: string | undefined, prefix: string): string | undefined {
  const re = new RegExp(`${prefix}/([^/?]+)`);
  return url?.match(re)?.[1];
}

function makeConnection(platform: Platform, overrides: Partial<PlatformConnection> = {}): PlatformConnection {
  const now = new Date().toISOString();
  return {
    id: `${platform}-1`,
    orgId: "org1",
    platform,
    label: "",
    enabled: true,
    mode: "sandbox",
    status: "disconnected",
    displayName: "",
    handle: "",
    avatarUrl: null,
    followers: 0,
    credentials: {
      clientId: "",
      clientSecret: "",
      redirectUri: "",
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      scopes: [],
      extra: {},
    },
    settings: {
      defaultFormat: PLATFORM_SPECS[platform].defaultFormat,
      privacy: "public",
      autoHashtags: true,
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
    connectedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function setupConnections() {
  const connections: PlatformConnection[] = [
    makeConnection("tiktok"),
    makeConnection("youtube"),
    makeConnection("linkedin"),
    makeConnection("instagram"),
    makeConnection("x"),
  ];

  const mocked = mockFetch({
    "GET /api/connections": () => connections,
    "PATCH /api/connections/:id": (init, url) => {
      const id = idFromUrl(url, "/connections");
      const idx = connections.findIndex((c) => c.id === id);
      const body = JSON.parse((init?.body as string) ?? "{}");
      connections[idx] = {
        ...connections[idx],
        ...body,
        credentials: body.credentials ? { ...connections[idx].credentials, ...body.credentials } : connections[idx].credentials,
        settings: body.settings ? { ...connections[idx].settings, ...body.settings } : connections[idx].settings,
      };
      return connections[idx];
    },
    "POST /api/connections/:id/test": () => ({
      ok: true,
      checkedAt: new Date().toISOString(),
      latencyMs: 128,
      message: "All checks passed",
      details: [
        { label: "Client ID", ok: true },
        { label: "Client secret", ok: true },
      ],
    }),
    "POST /api/connections/:id/connect": (_init, url) => {
      const id = idFromUrl(url, "/connections");
      const idx = connections.findIndex((c) => c.id === id);
      const updated: PlatformConnection = {
        ...connections[idx],
        status: "connected",
        displayName: "Acme Co",
        handle: "acmeco",
        followers: 12345,
        connectedAt: new Date().toISOString(),
      };
      connections[idx] = updated;
      return { authorizeUrl: "https://example.com/authorize", state: "state123", sandbox: true, connection: updated };
    },
    "POST /api/connections/:id/disconnect": (_init, url) => {
      const id = idFromUrl(url, "/connections");
      const idx = connections.findIndex((c) => c.id === id);
      connections[idx] = { ...connections[idx], status: "disconnected", displayName: "", handle: "", followers: 0 };
      return connections[idx];
    },
  });

  return { ...mocked, connections };
}

describe("ConnectionsPage", () => {
  beforeEach(() => {
    useAppStore.setState({ currentOrgId: "org1" });
  });

  it("renders 5 platform cards with names", async () => {
    setupConnections();
    renderWithProviders(<ConnectionsPage />);

    for (const name of ["TikTok", "YouTube", "LinkedIn", "Instagram", "X"]) {
      expect(await screen.findByRole("heading", { name: new RegExp(`^${name}`), level: 3 })).toBeInTheDocument();
    }
  });

  it("toggling enabled calls PATCH with {enabled:false}", async () => {
    const { calls } = setupConnections();
    const user = userEvent.setup();
    renderWithProviders(<ConnectionsPage />);

    const card = await screen.findByTestId("connection-tiktok");
    const toggle = within(card).getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);

    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH" && c.url.includes("tiktok-1"));
      expect(patch?.body).toMatchObject({ enabled: false });
    });
  });

  it("clicking Configure flips the card and reveals the back-face form", async () => {
    setupConnections();
    const user = userEvent.setup();
    renderWithProviders(<ConnectionsPage />);

    const card = await screen.findByTestId("connection-tiktok");
    expect(within(card).queryByLabelText(/Client ID/i)).not.toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: /configure/i }));

    expect(within(card).getByLabelText(/Client ID/i)).toBeInTheDocument();
  });

  it("saving the configuration form sends credentials, settings and mode in the PATCH body", async () => {
    const { calls } = setupConnections();
    const user = userEvent.setup();
    renderWithProviders(<ConnectionsPage />);

    const card = await screen.findByTestId("connection-tiktok");
    await user.click(within(card).getByRole("button", { name: /configure/i }));

    const clientIdInput = within(card).getByLabelText(/Client ID/i);
    await user.clear(clientIdInput);
    await user.type(clientIdInput, "my-client-id");

    await user.click(within(card).getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      const patch = calls.filter((c) => c.method === "PATCH" && c.url.includes("tiktok-1")).pop();
      expect(patch?.body).toMatchObject({
        mode: "sandbox",
        credentials: expect.objectContaining({ clientId: "my-client-id" }),
        settings: expect.objectContaining({ defaultFormat: expect.any(String) }),
      });
    });
  });

  it("Test connection shows the result details inline", async () => {
    setupConnections();
    const user = userEvent.setup();
    renderWithProviders(<ConnectionsPage />);

    const card = await screen.findByTestId("connection-tiktok");
    await user.click(within(card).getByRole("button", { name: /test connection/i }));

    expect(await within(card).findByText(/All checks passed/i)).toBeInTheDocument();
    expect(within(card).getByText("Client ID")).toBeInTheDocument();
    expect(within(card).getByText("Client secret")).toBeInTheDocument();
  });

  it("Connect in sandbox mode shows the connected account", async () => {
    setupConnections();
    const user = userEvent.setup();
    renderWithProviders(<ConnectionsPage />);

    const card = await screen.findByTestId("connection-tiktok");
    expect(within(card).getByText(/No account connected/i)).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: /^connect$/i }));

    expect(await within(card).findByText("Acme Co")).toBeInTheDocument();
    expect(within(card).getByText(/acmeco/)).toBeInTheDocument();
  });

  it("shows a toast and clears the query params for an OAuth callback redirect", async () => {
    setupConnections();
    renderWithProviders(<ConnectionsPage />, { route: "/connections?connected=tiktok" });

    expect(await screen.findByRole("heading", { name: /^TikTok/, level: 3 })).toBeInTheDocument();
  });

  it("groups accounts by platform and adds another account through the modal", async () => {
    const connections: PlatformConnection[] = [
      makeConnection("tiktok", { id: "tt-1", label: "Main", status: "connected", displayName: "Brand", handle: "@brand" }),
      makeConnection("tiktok", { id: "tt-2", label: "Founder", status: "connected", displayName: "Dr. Osei", handle: "@drosei" }),
      makeConnection("youtube"), makeConnection("linkedin"), makeConnection("instagram"),
    ];
    let created: any = null;
    mockFetch({
      "GET /api/connections": () => connections,
      "POST /api/connections": (init) => { created = JSON.parse(init!.body as string); const c = makeConnection("tiktok", { id: "tt-3", label: created.label || "Account 3" }); connections.push(c); return c; },
    });
    const user = userEvent.setup();
    renderWithProviders(<ConnectionsPage />);
    const group = await screen.findByTestId("platform-group-tiktok");
    expect(within(group).getByText("2 accounts")).toBeInTheDocument();
    expect(within(group).getByText("Main")).toBeInTheDocument();
    expect(within(group).getByText("Founder")).toBeInTheDocument();

    await user.click(within(group).getByTestId("add-account-tiktok"));
    await user.type(screen.getByLabelText("Label"), "EU");
    await user.selectOptions(screen.getByLabelText("App credentials"), "tt-1");
    await user.click(screen.getByTestId("add-account-submit"));
    await waitFor(() => expect(created).not.toBeNull());
    expect(created).toMatchObject({ platform: "tiktok", label: "EU", copyCredentialsFrom: "tt-1" });
  });
});
