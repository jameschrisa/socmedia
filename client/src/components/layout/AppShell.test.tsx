import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { createTestQueryClient, mockFetch } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { AppShell } from "./AppShell";

// AppShell renders ComposerDrawer, which pulls in ImageEditor's Konva stack; jsdom can't load
// Konva's node canvas backend, so these are mocked the same way ImageEditor's own tests do it.
vi.mock("react-konva", async () => {
  const React = await import("react");
  return {
    Stage: React.forwardRef(({ children }: any, ref: any) => <div data-testid="stage" ref={ref}>{children}</div>),
    Layer: ({ children }: any) => <>{children}</>,
    Image: React.forwardRef(() => null),
    Rect: () => null,
    Text: () => null,
    Line: () => null,
    Group: ({ children }: any) => <>{children}</>,
    Transformer: React.forwardRef(() => null),
  };
});
vi.mock("use-image", () => ({ default: () => [undefined, "loading"] }));
vi.mock("konva", () => ({
  default: { Filters: { Brighten: vi.fn(), Contrast: vi.fn(), HSL: vi.fn(), Blur: vi.fn(), Grayscale: vi.fn(), Sepia: vi.fn(), Noise: vi.fn() } },
}));

function meRoute() {
  return () => ({
    authenticated: true,
    needsSetup: false,
    user: { id: "me", email: "me@suprstar.com", name: "Me Owner", role: "owner", orgIds: "*", active: true, mustChangePassword: false, createdAt: "" },
  });
}

function renderShell() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div data-testid="overview-page">Overview</div>} />
          </Route>
          <Route path="/console" element={<div data-testid="console-page">Console page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    useAppStore.setState({ consoleReturnTo: "/" });
  });

  it("navigates to /console on Ctrl+`", async () => {
    mockFetch({
      "GET /api/auth/me": meRoute(),
      "GET /api/orgs": () => [],
    });
    renderShell();
    await screen.findByTestId("overview-page");

    fireEvent.keyDown(window, { key: "`", code: "Backquote", ctrlKey: true });

    expect(await screen.findByTestId("console-page")).toBeInTheDocument();
    expect(useAppStore.getState().consoleReturnTo).toBe("/");
  });
});
