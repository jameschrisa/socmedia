import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { OrgSwitcher } from "@/components/layout/OrgSwitcher";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import type { Organization } from "@socmedia/shared";

const orgs: Organization[] = [
  { id: "org1", name: "Holistiplan", slug: "holistiplan", brandColor: "#6C5CE7", timezone: "America/Chicago", createdAt: "" },
  { id: "org2", name: "Northstar Advisors", slug: "northstar", brandColor: "#0EA5E9", timezone: "America/New_York", createdAt: "" },
];

describe("OrgSwitcher", () => {
  beforeEach(() => useAppStore.setState({ currentOrgId: "org1" }));

  it("shows the current organization and switches on selection", async () => {
    mockFetch({ "GET /api/orgs": () => orgs });
    renderWithProviders(<OrgSwitcher />);
    await waitFor(() => expect(screen.getByTestId("org-switcher")).toHaveTextContent("Holistiplan"));
    fireEvent.click(screen.getByTestId("org-switcher"));
    fireEvent.click(await screen.findByRole("option", { name: /Northstar Advisors/ }));
    expect(useAppStore.getState().currentOrgId).toBe("org2");
  });

  it("falls back to the first org when the stored id is unknown", async () => {
    useAppStore.setState({ currentOrgId: "missing" });
    mockFetch({ "GET /api/orgs": () => orgs });
    renderWithProviders(<OrgSwitcher />);
    await waitFor(() => expect(useAppStore.getState().currentOrgId).toBe("org1"));
  });

  it("creates a new organization and switches to it", async () => {
    const created: Organization = { id: "org3", name: "Acme Wealth", slug: "acme-wealth", brandColor: "#7C5CFC", timezone: "UTC", createdAt: "" };
    const { calls } = mockFetch({
      "GET /api/orgs": () => (calls.some((c) => c.method === "POST") ? [...orgs, created] : orgs),
      "POST /api/orgs": () => created,
    });
    renderWithProviders(<OrgSwitcher />);
    await screen.findByText("Holistiplan");
    fireEvent.click(screen.getByTestId("org-switcher"));
    fireEvent.click(await screen.findByText("New organization"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme Wealth" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(useAppStore.getState().currentOrgId).toBe("org3"));
    const post = calls.find((c) => c.method === "POST")!;
    expect((post.body as any).name).toBe("Acme Wealth");
    expect((post.body as any).slug).toBe("acme-wealth");
  });
});
