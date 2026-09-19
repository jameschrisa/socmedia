import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlatformConnection, QuickPostToken } from "@socmedia/shared";
import { PLATFORM_SPECS } from "@socmedia/shared";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { QuickPostSection } from "./QuickPostSection";

function makeConnection(overrides: Partial<PlatformConnection> = {}): PlatformConnection {
  const now = new Date().toISOString();
  return {
    id: "conn-1", orgId: "org1", platform: "tiktok", label: "Founder", enabled: true, mode: "sandbox",
    status: "connected", displayName: "Founder", handle: "@founder", avatarUrl: null, followers: 100,
    credentials: { clientId: "", clientSecret: "", redirectUri: "", accessToken: null, refreshToken: null, tokenExpiresAt: null, scopes: [], extra: {} },
    settings: {
      defaultFormat: PLATFORM_SPECS.tiktok.defaultFormat, privacy: "public", autoHashtags: true, firstCommentHashtags: false,
      allowComments: true, allowDuet: true, allowStitch: true, madeForKids: false, category: "22", postAsOrganization: false, shareToFeed: true,
    } as any,
    lastTest: null, connectedAt: now, createdAt: now, updatedAt: now,
    ...overrides,
  };
}

function makeToken(overrides: Partial<QuickPostToken> = {}): QuickPostToken {
  return {
    id: "qt-1", orgId: "org1", userId: "me", label: "Front desk", tokenPreview: "ab12",
    connectionIds: [], publishMode: "all", active: true, usesCount: 3, createdAt: "2026-09-01T00:00:00Z", lastUsedAt: null,
    ...overrides,
  };
}

describe("QuickPostSection", () => {
  beforeEach(() => {
    useAppStore.setState({ currentOrgId: "org1" });
  });

  it("lists existing quick post links", async () => {
    mockFetch({
      "GET /api/connections": () => [makeConnection()],
      "GET /api/quick/tokens": () => [makeToken()],
    });
    renderWithProviders(<QuickPostSection />);

    expect(await screen.findByText("Front desk")).toBeInTheDocument();
    expect(screen.getByText("All enabled accounts")).toBeInTheDocument();
    expect(screen.getByText("All at once")).toBeInTheDocument();
  });

  it("creates a link and reveals the one-time URL and QR code", async () => {
    const { calls } = mockFetch({
      "GET /api/connections": () => [makeConnection()],
      "GET /api/quick/tokens": () => [],
      "POST /api/quick/tokens": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        return makeToken({ id: "qt-new", label: body.label, connectionIds: body.connectionIds, publishMode: body.publishMode, token: "supersecrettoken123" });
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<QuickPostSection />);

    await user.click(await screen.findByRole("button", { name: "Create link" }));
    await user.type(screen.getByLabelText("Label"), "Lobby iPad");
    await user.click(screen.getByRole("checkbox", { name: /Founder/ }));
    const createButtons = screen.getAllByRole("button", { name: "Create link" });
    await user.click(createButtons[createButtons.length - 1]!);

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/quick/tokens"))).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ label: "Lobby iPad", connectionIds: ["conn-1"], publishMode: "all" });

    const urlField = await screen.findByTestId("quick-link-url");
    expect(urlField).toHaveValue(`${window.location.origin}/go/supersecrettoken123`);
    await waitFor(() => expect(screen.getByTestId("quick-link-qr")).toBeInTheDocument());
    expect(screen.getByText(/iOS Shortcut/)).toBeInTheDocument();
  });
});
