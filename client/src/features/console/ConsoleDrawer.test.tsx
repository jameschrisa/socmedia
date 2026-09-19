import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LogEntry } from "@socmedia/shared";
import { renderWithProviders, mockFetch, installMockEventSource } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { ConsoleDrawer } from "./ConsoleDrawer";

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: "log-1",
    at: "2026-09-19T10:42:07.000Z",
    level: "info",
    source: "publisher",
    message: "Published to TikTok (Founder)",
    ...overrides,
  };
}

function meRoute() {
  return () => ({
    authenticated: true,
    needsSetup: false,
    user: { id: "me", email: "me@suprstar.com", name: "Me Owner", role: "owner", orgIds: "*", active: true, mustChangePassword: false, createdAt: "" },
  });
}

let restoreEventSource: () => void;

describe("ConsoleDrawer", () => {
  beforeEach(() => {
    restoreEventSource = installMockEventSource();
    useAppStore.setState({ consoleOpen: true, consoleHistory: [] });
  });

  afterEach(() => {
    restoreEventSource();
    useAppStore.setState({ consoleOpen: false, consoleHistory: [] });
  });

  it("loads and renders the last log entries from GET /logs", async () => {
    mockFetch({
      "GET /api/auth/me": meRoute(),
      "GET /api/logs": () => ({ entries: [makeEntry(), makeEntry({ id: "log-2", level: "error", message: "Publish failed for LinkedIn" })] }),
    });
    renderWithProviders(<ConsoleDrawer />);

    expect(await screen.findByText(/Published to TikTok \(Founder\)/)).toBeInTheDocument();
    expect(screen.getByText(/Publish failed for LinkedIn/)).toBeInTheDocument();
    expect(screen.getByText("info")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("sends a command to the agent and renders the reply with its actions", async () => {
    const { calls } = mockFetch({
      "GET /api/auth/me": meRoute(),
      "GET /api/logs": () => ({ entries: [] }),
      "POST /api/agent/commands": () => ({
        id: "cmd-1",
        input: "/status",
        reply: "Scheduler is running. 3 posts due in the next hour.",
        actions: [{ tool: "get_status", input: {}, ok: true, summary: "Fetched scheduler status" }],
        model: "mock",
        mock: true,
        at: "2026-09-19T10:43:00.000Z",
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<ConsoleDrawer />);
    await waitFor(() => expect(screen.getByTestId("console-drawer")).toBeInTheDocument());

    const input = screen.getByLabelText("Console command");
    await user.type(input, "/status");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/agent/commands"))).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ input: "/status" });

    expect(await screen.findByText(/you ❯/)).toBeInTheDocument();
    expect(await screen.findByText(/Scheduler is running/)).toBeInTheDocument();
    expect(await screen.findByText(/get_status: Fetched scheduler status/)).toBeInTheDocument();
  });

  it("clears the console locally on /clear without sending a request", async () => {
    const { calls } = mockFetch({
      "GET /api/auth/me": meRoute(),
      "GET /api/logs": () => ({ entries: [makeEntry()] }),
    });
    const user = userEvent.setup();
    renderWithProviders(<ConsoleDrawer />);
    expect(await screen.findByText(/Published to TikTok/)).toBeInTheDocument();

    const input = screen.getByLabelText("Console command");
    await user.type(input, "/clear");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByText(/Published to TikTok/)).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === "POST" && c.url.includes("/agent/commands"))).toBe(false);
  });

  it("re-requests logs when the level filter changes", async () => {
    const { calls } = mockFetch({
      "GET /api/auth/me": meRoute(),
      "GET /api/logs": () => ({ entries: [makeEntry()] }),
    });
    const user = userEvent.setup();
    renderWithProviders(<ConsoleDrawer />);
    await screen.findByText(/Published to TikTok/);

    await user.selectOptions(screen.getByLabelText("Filter by level"), "warn");

    await waitFor(() => expect(calls.some((c) => c.method === "GET" && c.url.includes("level=warn"))).toBe(true));
  });

  it("filters visible lines by free text without a request", async () => {
    mockFetch({
      "GET /api/auth/me": meRoute(),
      "GET /api/logs": () => ({ entries: [makeEntry({ id: "a", message: "Published to TikTok" }), makeEntry({ id: "b", message: "Refreshed YouTube token" })] }),
    });
    const user = userEvent.setup();
    renderWithProviders(<ConsoleDrawer />);
    await screen.findByText(/Published to TikTok/);
    expect(screen.getByText(/Refreshed YouTube token/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search log messages"), "TikTok");

    expect(screen.getByText(/Published to TikTok/)).toBeInTheDocument();
    expect(screen.queryByText(/Refreshed YouTube token/)).not.toBeInTheDocument();
  });
});
