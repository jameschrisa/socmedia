import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetch, installMockWebSocket, MockWebSocket } from "@/test-utils";
import { TerminalPane } from "./TerminalPane";

// vi.mock factories are hoisted above imports/top-level consts, so the mock Terminal class has
// to be declared via vi.hoisted to avoid a temporal-dead-zone reference error.
const { MockTerminal } = vi.hoisted(() => {
  /** Minimal double for `@xterm/xterm`'s Terminal: just enough surface for TerminalPane. */
  class MockTerminal {
    static instances: MockTerminal[] = [];
    cols = 80;
    rows = 24;
    written: string[] = [];
    private dataHandler: ((data: string) => void) | null = null;

    constructor() {
      MockTerminal.instances.push(this);
    }
    open() {}
    write(data: string) {
      this.written.push(data);
    }
    onData(cb: (data: string) => void) {
      this.dataHandler = cb;
      return { dispose: () => {} };
    }
    loadAddon() {}
    dispose() {}
    emitData(data: string) {
      this.dataHandler?.(data);
    }
  }
  return { MockTerminal };
});

vi.mock("@xterm/xterm", () => ({ Terminal: MockTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));

function terminalStatus(overrides: Partial<Record<string, unknown>> = {}) {
  return () => ({
    enabled: true,
    reason: null,
    platform: "darwin",
    shell: "/bin/zsh",
    hostname: "api-host",
    user: "svc",
    cwd: "/srv/app",
    pty: true,
    ...overrides,
  });
}

let restoreWebSocket: () => void;

describe("TerminalPane", () => {
  beforeEach(() => {
    MockTerminal.instances = [];
    restoreWebSocket = installMockWebSocket();
  });

  afterEach(() => {
    restoreWebSocket();
  });

  it("shows the server's disabled reason instead of connecting", async () => {
    mockFetch({
      "GET /api/terminal/status": () => ({ enabled: false, reason: "Only owners and admins can open a shell.", platform: "darwin", shell: "/bin/zsh", hostname: "api", user: "svc", cwd: "/", pty: true }),
    });
    renderWithProviders(<TerminalPane />);

    expect(await screen.findByTestId("terminal-disabled")).toHaveTextContent("Only owners and admins can open a shell.");
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("shows the pipe-fallback hint when there is no pseudo-terminal", async () => {
    mockFetch({ "GET /api/terminal/status": terminalStatus({ pty: false }) });
    renderWithProviders(<TerminalPane />);

    expect(await screen.findByText(/interactive programs and line editing are limited/i)).toBeInTheDocument();
  });

  it("opens a WebSocket, sends xterm input, and writes server output", async () => {
    mockFetch({ "GET /api/terminal/status": terminalStatus() });
    renderWithProviders(<TerminalPane />);

    await screen.findByTestId("xterm-container");
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0]!;
    expect(ws.url).toContain("/api/terminal?cols=80&rows=24");

    ws.dispatchOpen();
    ws.dispatchMessage({ type: "ready", status: terminalStatus()(), cols: 80, rows: 24 });

    const term = MockTerminal.instances[0]!;
    term.emitData("ls -la\r");
    await waitFor(() => expect(ws.sent.some((s) => JSON.parse(s).type === "input" && JSON.parse(s).data === "ls -la\r")).toBe(true));

    ws.dispatchMessage({ type: "output", data: "total 0\r\n" });
    await waitFor(() => expect(term.written).toContain("total 0\r\n"));
  });

  it("shows an inline error with a restart action when the socket errors", async () => {
    mockFetch({ "GET /api/terminal/status": terminalStatus() });
    renderWithProviders(<TerminalPane />);

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0]!;
    ws.dispatchMessage({ type: "error", message: "shell crashed" });

    expect(await screen.findByText("shell crashed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart shell" })).toBeInTheDocument();
  });
});
