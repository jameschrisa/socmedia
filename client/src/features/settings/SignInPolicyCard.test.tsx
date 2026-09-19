import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { SignInPolicyCard } from "./SignInPolicyCard";

describe("SignInPolicyCard", () => {
  it("rejects an invalid domain, adds a valid one (lowercased), and saves the policy", async () => {
    const { calls } = mockFetch({
      "GET /api/orgs": () => [{ id: "org1", name: "Meridian Labs", slug: "meridian", brandColor: "#000", timezone: "UTC", createdAt: "" }],
      "GET /api/settings/access-policy": () => ({ domains: [], allowInvitedUsersAnyDomain: true }),
      "PUT /api/settings/access-policy": (init) => JSON.parse((init?.body as string) ?? "{}"),
    });
    const user = userEvent.setup();
    renderWithProviders(<SignInPolicyCard />);

    await screen.findByText(/no allowed domains yet/i);

    const input = screen.getByLabelText("Add domain");
    await user.type(input, "not-a-domain");
    await user.click(screen.getByRole("button", { name: "Add domain" }));
    expect(await screen.findByText(/enter a domain like example\.com/i)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "Acme.COM");
    await user.click(screen.getByRole("button", { name: "Add domain" }));

    expect(await screen.findByText("@acme.com")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByTestId("save-access-policy"));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({
      domains: [{ domain: "acme.com", role: "editor", orgSlugs: "*" }],
      allowInvitedUsersAnyDomain: true,
    });
  });

  it("rejects a duplicate domain", async () => {
    mockFetch({
      "GET /api/orgs": () => [],
      "GET /api/settings/access-policy": () => ({ domains: [{ domain: "acme.com", role: "editor", orgSlugs: "*" }], allowInvitedUsersAnyDomain: true }),
    });
    const user = userEvent.setup();
    renderWithProviders(<SignInPolicyCard />);

    await screen.findByText("@acme.com");
    await user.type(screen.getByLabelText("Add domain"), "acme.com");
    await user.click(screen.getByRole("button", { name: "Add domain" }));
    expect(await screen.findByText(/already listed/i)).toBeInTheDocument();
  });
});
