import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { RequireAuth } from "./RequireAuth";

describe("RequireAuth", () => {
  it("shows the login page when unauthenticated", async () => {
    mockFetch({ "GET /api/auth/me": () => ({ authenticated: false, needsSetup: false, user: null }) });
    renderWithProviders(
      <RequireAuth>
        <div>Secret dashboard</div>
      </RequireAuth>,
    );
    expect(await screen.findByRole("heading", { name: /only authorized suprstars allowed/i })).toBeInTheDocument();
    expect(screen.queryByText("Secret dashboard")).not.toBeInTheDocument();
  });

  it("renders children once authenticated", async () => {
    mockFetch({
      "GET /api/auth/me": () => ({
        authenticated: true,
        needsSetup: false,
        user: { id: "u1", email: "a@b.com", name: "Ada", role: "editor", orgIds: "*", active: true, mustChangePassword: false, createdAt: "", lastLoginAt: null },
      }),
    });
    renderWithProviders(
      <RequireAuth>
        <div>Secret dashboard</div>
      </RequireAuth>,
    );
    expect(await screen.findByText("Secret dashboard")).toBeInTheDocument();
  });
});
