import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Organization } from "@socmedia/shared";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { SettingsPage } from "./SettingsPage";

function makeOrg(id: string, overrides: Partial<Organization> = {}): Organization {
  return {
    id,
    name: `Org ${id}`,
    slug: `org-${id}`,
    brandColor: "#7C5CFC",
    timezone: "UTC",
    logoUrl: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("SettingsPage", () => {
  beforeEach(() => {
    useAppStore.setState({ currentOrgId: "org1" });
  });

  it("lists organizations and switching updates the store", async () => {
    mockFetch({
      "GET /api/orgs": () => [makeOrg("org1", { name: "Acme" }), makeOrg("org2", { name: "Beta" })],
    });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();

    await user.click(screen.getByText("Beta"));

    await waitFor(() => expect(useAppStore.getState().currentOrgId).toBe("org2"));
  });

  it("creates a new organization and switches to it", async () => {
    const orgs: Organization[] = [makeOrg("org1", { name: "Acme" })];
    const { calls } = mockFetch({
      "GET /api/orgs": () => orgs,
      "POST /api/orgs": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const org = makeOrg("org2", { name: body.name, brandColor: body.brandColor, timezone: body.timezone });
        orgs.push(org);
        return org;
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Acme");
    await user.click(screen.getByRole("button", { name: /new organization/i }));

    const nameInput = await screen.findByLabelText(/^name$/i);
    await user.type(nameInput, "Beta Inc");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url.includes("/orgs"));
      expect(post?.body).toMatchObject({ name: "Beta Inc" });
    });

    await waitFor(() => expect(useAppStore.getState().currentOrgId).toBe("org2"));
  });

  it("saves publishing defaults and lists accounts per platform", async () => {
    let saved: any = null;
    mockFetch({
      "GET /api/orgs": () => [makeOrg("org1")],
      "GET /api/settings/publishing": () => ({ defaultPublishMode: "all", queueSpacingMinutes: 10, warnOnDuplicateCaptions: true }),
      "PUT /api/settings/publishing": (init) => { saved = JSON.parse(init!.body as string); return saved; },
      "GET /api/connections": () => [
        { id: "c1", orgId: "org1", platform: "tiktok", label: "Main", enabled: true, mode: "sandbox", status: "connected", displayName: "Main", handle: "@main", avatarUrl: null, followers: 1, credentials: { clientId: "", clientSecret: "", redirectUri: "", scopes: [], extra: {} }, settings: {}, lastTest: null, connectedAt: null, createdAt: "", updatedAt: "" },
        { id: "c2", orgId: "org1", platform: "tiktok", label: "Second", enabled: false, mode: "live", status: "disconnected", displayName: "", handle: "", avatarUrl: null, followers: 0, credentials: { clientId: "", clientSecret: "", redirectUri: "", scopes: [], extra: {} }, settings: {}, lastTest: null, connectedAt: null, createdAt: "", updatedAt: "" },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    const tiktok = await screen.findByTestId("accounts-tiktok");
    expect(within(tiktok).getByText("Main")).toBeInTheDocument();
    expect(within(tiktok).getByText("Second")).toBeInTheDocument();
    expect(within(tiktok).getByText("Live")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Queue" }));
    await user.click(screen.getByTestId("publishing-save"));
    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved.defaultPublishMode).toBe("queue");
  });
});
