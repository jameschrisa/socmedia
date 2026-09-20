import { describe, it, expect, beforeEach } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestQueryClient, mockFetch } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { ConsolePage } from "./ConsolePage";

function meRoute() {
  return () => ({
    authenticated: true,
    needsSetup: false,
    user: { id: "me", email: "me@suprstar.com", name: "Me Owner", role: "owner", orgIds: "*", active: true, mustChangePassword: false, createdAt: "" },
  });
}

function renderConsole(initialPath = "/console") {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/console" element={<ConsolePage />} />
          <Route path="/calendar" element={<div data-testid="calendar-page">Calendar page</div>} />
          <Route path="/" element={<div data-testid="home-page">Home page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ConsolePage", () => {
  beforeEach(() => {
    useAppStore.setState({ consoleReturnTo: "/", consoleHistory: [] });
  });

  it("renders the Agent pane and the Activity log / Terminal toggle", async () => {
    mockFetch({
      "GET /api/auth/me": meRoute(),
      "GET /api/orgs": () => [{ id: "org-1", name: "Larkspur Health" }],
      "GET /api/logs": () => ({ entries: [] }),
    });
    renderConsole();

    expect(await screen.findByLabelText("Console command")).toBeInTheDocument();
    expect(screen.getByTestId("console-commands-trigger")).toBeInTheDocument();
    const rightTab = screen.getByTestId("console-right-tab");
    expect(within(rightTab).getByRole("tab", { name: "Activity log" })).toBeInTheDocument();
    expect(within(rightTab).getByRole("tab", { name: "Terminal" })).toBeInTheDocument();
    expect(await screen.findByText("Larkspur Health")).toBeInTheDocument();
    expect(screen.getByText("Me Owner")).toBeInTheDocument();
  });

  it("closes back to the route stored in consoleReturnTo", async () => {
    useAppStore.setState({ consoleReturnTo: "/calendar" });
    mockFetch({
      "GET /api/auth/me": meRoute(),
      "GET /api/orgs": () => [],
      "GET /api/logs": () => ({ entries: [] }),
    });
    const user = userEvent.setup();
    renderConsole();
    await screen.findByLabelText("Console command");

    await user.click(screen.getByTestId("console-close"));

    expect(await screen.findByTestId("calendar-page")).toBeInTheDocument();
  });

  it("switches the right pane between Activity log and Terminal", async () => {
    mockFetch({
      "GET /api/auth/me": meRoute(),
      "GET /api/orgs": () => [],
      "GET /api/logs": () => ({ entries: [] }),
      "GET /api/terminal/status": () => ({ enabled: false, reason: "Only owners and admins can open a shell.", platform: "darwin", shell: "/bin/zsh", hostname: "api", user: "svc", cwd: "/", pty: true }),
    });
    const user = userEvent.setup();
    renderConsole();
    await screen.findByTestId("console-scroll");

    await user.click(screen.getByRole("tab", { name: "Terminal" }));

    expect(await screen.findByTestId("terminal-disabled")).toHaveTextContent("Only owners and admins can open a shell.");
    expect(screen.queryByTestId("console-scroll")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Activity log" }));
    expect(await screen.findByTestId("console-scroll")).toBeInTheDocument();
  });
});
