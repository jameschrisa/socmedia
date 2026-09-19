import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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
});
