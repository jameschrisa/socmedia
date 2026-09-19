import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccessRequest } from "@socmedia/shared";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { AccessRequestsCard } from "./AccessRequestsCard";

function makeRequest(overrides: Partial<AccessRequest> = {}): AccessRequest {
  return {
    id: "req1",
    name: "Ada Lovelace",
    email: "ada@acme.com",
    organization: "Acme",
    message: "Let me in please",
    status: "pending",
    createdAt: "2026-09-19T00:00:00Z",
    ...overrides,
  };
}

describe("AccessRequestsCard", () => {
  it("approves a pending request and shows the returned temporary password", async () => {
    mockFetch({
      "GET /api/orgs": () => [{ id: "org1", name: "Meridian Labs", slug: "meridian", brandColor: "#000", timezone: "UTC", createdAt: "" }],
      "GET /api/users/access-requests": () => [makeRequest()],
      "POST /api/users/access-requests/req1/approve": () => ({
        request: makeRequest({ status: "approved" }),
        user: { id: "u1", email: "ada@acme.com", name: "Ada Lovelace", role: "editor", orgIds: "*", active: true, mustChangePassword: true, createdAt: "", lastLoginAt: null },
        temporaryPassword: "Sup3rSecret!",
        magicLinkSent: false,
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<AccessRequestsCard />);

    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Approve" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    expect(await screen.findByLabelText("Temporary password")).toHaveValue("Sup3rSecret!");
  });

  it("declines a pending request and removes it from the list", async () => {
    let requests = [makeRequest()];
    mockFetch({
      "GET /api/orgs": () => [],
      "GET /api/users/access-requests": () => requests,
      "POST /api/users/access-requests/req1/decline": () => {
        requests = requests.filter((r) => r.id !== "req1");
        return makeRequest({ status: "declined" });
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<AccessRequestsCard />);

    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Decline" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Decline" }));

    await waitFor(() => expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument());
    expect(await screen.findByText(/no pending requests/i)).toBeInTheDocument();
  });
});
