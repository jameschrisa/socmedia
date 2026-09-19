import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { TopNav } from "./TopNav";

function authRoute(role: "owner" | "admin" | "editor" | "viewer" = "editor") {
  return () => ({
    authenticated: true,
    needsSetup: false,
    user: { id: "u1", email: "ada@suprstar.com", name: "Ada Lovelace", role, orgIds: "*", active: true, mustChangePassword: false, createdAt: "", lastLoginAt: null },
  });
}

describe("TopNav", () => {
  it("shows the signed-in user's name and role in the account menu", async () => {
    mockFetch({ "GET /api/auth/me": authRoute("admin"), "GET /api/orgs": () => [] });
    const user = userEvent.setup();
    renderWithProviders(<TopNav />);

    const trigger = await screen.findByTestId("user-menu-trigger");
    expect(trigger).toHaveTextContent("AL");
    await user.click(trigger);

    const menu = await screen.findByTestId("user-menu");
    expect(menu).toHaveTextContent("Ada Lovelace");
    expect(menu).toHaveTextContent("ada@suprstar.com");
    expect(menu).toHaveTextContent("admin");
    expect(screen.getByRole("button", { name: /users/i })).toBeInTheDocument();
  });

  it("hides New post and AI Assistant for viewers but keeps navigation", async () => {
    mockFetch({ "GET /api/auth/me": authRoute("viewer"), "GET /api/orgs": () => [] });
    renderWithProviders(<TopNav />);
    await screen.findByTestId("user-menu-trigger");
    expect(screen.queryByTestId("new-post")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-toggle")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Calendar" })).toBeInTheDocument();
  });

  it("does not render a user menu when there is no signed-in user", async () => {
    mockFetch({ "GET /api/orgs": () => [] });
    renderWithProviders(<TopNav />);
    await screen.findByRole("link", { name: "Calendar" });
    expect(screen.queryByTestId("user-menu-trigger")).not.toBeInTheDocument();
  });

  it("signs out and posts to /api/auth/logout", async () => {
    const { calls } = mockFetch({
      "GET /api/auth/me": authRoute("owner"),
      "GET /api/orgs": () => [],
      "POST /api/auth/logout": () => undefined,
    });
    const user = userEvent.setup();
    renderWithProviders(<TopNav />);

    await user.click(await screen.findByTestId("user-menu-trigger"));
    await user.click(await screen.findByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/auth/logout"))).toBe(true));
  });
});
