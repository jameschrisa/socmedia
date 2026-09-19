import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { RequestAccessPage } from "./RequestAccessPage";

describe("RequestAccessPage", () => {
  it("submits the request and shows a confirmation with the submitted email", async () => {
    const { calls } = mockFetch({
      "POST /api/auth/access-requests": () => ({
        id: "req1",
        name: "Ada Lovelace",
        email: "ada@acme.com",
        organization: "Acme",
        message: null,
        status: "pending",
        createdAt: "2026-09-19T00:00:00Z",
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<RequestAccessPage />, { route: "/request-access" });

    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Work email"), "ada@acme.com");
    await user.type(screen.getByLabelText("Organization"), "Acme");
    await user.click(screen.getByRole("button", { name: "Request access" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/auth/access-requests"))).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ name: "Ada Lovelace", email: "ada@acme.com", organization: "Acme" });

    expect(await screen.findByRole("heading", { name: /request received/i })).toBeInTheDocument();
    expect(screen.getByText(/ada@acme\.com/)).toBeInTheDocument();
    expect(screen.getByText(/an owner will review it/i)).toBeInTheDocument();
  });

  it("shows the pending-request message on a 409", async () => {
    mockFetch({
      "POST /api/auth/access-requests": () =>
        new Response(JSON.stringify({ error: "Conflict" }), { status: 409, headers: { "Content-Type": "application/json" } }),
    });
    const user = userEvent.setup();
    renderWithProviders(<RequestAccessPage />, { route: "/request-access" });

    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Work email"), "ada@acme.com");
    await user.click(screen.getByRole("button", { name: "Request access" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("There is already a pending request or an account for this email");
  });

  it("links back to sign in", async () => {
    mockFetch({});
    renderWithProviders(<RequestAccessPage />, { route: "/request-access" });
    expect(screen.getByRole("link", { name: /back to sign in/i })).toHaveAttribute("href", "/");
  });
});
