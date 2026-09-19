import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { User } from "@socmedia/shared";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { UsersCard } from "./UsersCard";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u1", email: "ada@suprstar.com", name: "Ada Lovelace", role: "editor", orgIds: "*",
    active: true, mustChangePassword: false, createdAt: "2026-01-01T00:00:00Z", lastLoginAt: "2026-09-18T00:00:00Z",
    ...overrides,
  };
}

function meRoute(role: "owner" | "admin") {
  return () => ({
    authenticated: true,
    needsSetup: false,
    user: makeUser({ id: "me", email: "me@suprstar.com", name: "Me Owner", role }),
  });
}

describe("UsersCard", () => {
  it("lists users and posts the expected body when inviting", async () => {
    const users = [makeUser(), makeUser({ id: "u2", name: "Bo Editor", email: "bo@suprstar.com", role: "viewer", active: false, orgIds: [] })];
    const { calls } = mockFetch({
      "GET /api/auth/me": meRoute("owner"),
      "GET /api/orgs": () => [{ id: "org1", name: "Meridian Labs", slug: "meridian", brandColor: "#000", timezone: "UTC", createdAt: "" }],
      "GET /api/users": () => users,
      "POST /api/users": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        return makeUser({ id: "u3", ...body });
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<UsersCard />);

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Bo Editor")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();

    await user.click(screen.getByTestId("invite-user-button"));
    await user.type(screen.getByLabelText("Name"), "New Person");
    await user.type(screen.getByLabelText("Email"), "new@suprstar.com");
    await user.selectOptions(screen.getByLabelText("Role"), "editor");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/users"))).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ name: "New Person", email: "new@suprstar.com", role: "editor", orgIds: "*" });
    expect((post.body as any).password).toHaveLength(12);

    expect(await screen.findByText(/Share this password with new@suprstar.com/)).toBeInTheDocument();
  });

  it("does not offer the owner role to an admin inviting a user", async () => {
    mockFetch({
      "GET /api/auth/me": meRoute("admin"),
      "GET /api/orgs": () => [],
      "GET /api/users": () => [makeUser()],
    });
    const user = userEvent.setup();
    renderWithProviders(<UsersCard />);

    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByTestId("invite-user-button"));
    const roleSelect = screen.getByLabelText("Role") as HTMLSelectElement;
    const options = within(roleSelect).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options).not.toContain("owner");
    expect(options).toEqual(expect.arrayContaining(["admin", "editor", "viewer"]));
  });
});
