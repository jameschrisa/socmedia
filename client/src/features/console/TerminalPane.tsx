import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import type { TerminalServerMessage } from "@socmedia/shared";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";

type SocketState = "connecting" | "open" | "closed" | "error";

const PING_INTERVAL_MS = 25_000;

/** The mono terminal stack, matching `.terminal`'s font-family in styles.css (Outfit isn't monospace). */
const MONO_STACK = "ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * Right-pane "Terminal" tab: a real shell on the API host over a WebSocket. Fetches
 * `/api/terminal/status` first so viewers/editors and disabled deployments get a plain
 * explanation instead of a broken connection attempt.
 */
export function TerminalPane() {
  const statusQuery = useQuery({ queryKey: qk.terminalStatus, queryFn: api.terminal.status, staleTime: 30_000 });
  // The ready frame carries the session's actual pty state (the status probe can only guess before a fork).
  const [sessionPty, setSessionPty] = useState<boolean | null>(null);
  const status = statusQuery.data ? { ...statusQuery.data, pty: sessionPty ?? statusQuery.data.pty } : statusQuery.data;

  const [sessionKey, setSessionKey] = useState(0);
  const [socketState, setSocketState] = useState<SocketState>("connecting");
  const [exitCode, setExitCode] = useState<number | null | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!status?.enabled || !containerRef.current) return;
    setSocketState("connecting");
    setExitCode(undefined);
    setErrorMessage(null);

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: MONO_STACK,
      fontSize: 13,
      theme: {
        background: "#0a0b10",
        foreground: "#f0eef3",
        cursor: "#59d8e6",
        cursorAccent: "#0a0b10",
        selectionBackground: "rgba(89,216,230,0.25)",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    try { fit.fit(); } catch { /* jsdom / not-yet-laid-out container */ }

    const ws = new WebSocket(api.terminal.wsUrl(term.cols, term.rows));
    socketRef.current = ws;

    ws.onmessage = (ev: MessageEvent) => {
      let msg: TerminalServerMessage;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "ready") {
        setSocketState("open");
        if (msg.status && typeof msg.status.pty === "boolean") setSessionPty(msg.status.pty);
      }
      else if (msg.type === "output") term.write(msg.data);
      else if (msg.type === "exit") { setExitCode(msg.code); setSocketState("closed"); }
      else if (msg.type === "error") { setErrorMessage(msg.message); setSocketState("error"); }
    };
    ws.onerror = () => setSocketState("error");
    ws.onclose = () => setSocketState((s) => (s === "error" ? s : "closed"));

    const dataDisposable = term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    });

    const sendResize = () => {
      try { fit.fit(); } catch { /* ignore */ }
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    const ro = new ResizeObserver(sendResize);
    ro.observe(containerRef.current);

    const pingId = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, PING_INTERVAL_MS);

    return () => {
      clearInterval(pingId);
      ro.disconnect();
      dataDisposable.dispose();
      ws.close();
      term.dispose();
      socketRef.current = null;
    };
  }, [status?.enabled, sessionKey]);

  const restart = useCallback(() => setSessionKey((k) => k + 1), []);
  const disconnect = useCallback(() => socketRef.current?.close(), []);

  if (statusQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      </div>
    );
  }

  if (statusQuery.isError || !status) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-ink-500">
        <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
        <p>Couldn't reach the terminal status endpoint.</p>
        <button type="button" className="focus-ring console-tap text-xs text-ink-500 underline underline-offset-2 hover:text-ink-100" onClick={() => statusQuery.refetch()}>Try again</button>
      </div>
    );
  }

  if (!status.enabled) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-ink-500" data-testid="terminal-disabled">
        <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
        <p>{status.reason || "The terminal isn't available right now."}</p>
      </div>
    );
  }

  const ended = socketState === "closed" || socketState === "error";
  // A close without an exit code or error message came from this side (Disconnect) or a dropped socket.
  const disconnected = socketState === "closed" && exitCode === undefined && !errorMessage;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5 text-xs text-ink-500" style={{ borderColor: "var(--c-edge)" }}>
        <span className="text-ink-700">{status.user}@{status.hostname}</span>
        <span aria-hidden>·</span>
        <span>{status.shell}</span>
        <span aria-hidden>·</span>
        <span className="min-w-0 truncate" title={status.cwd}>{status.cwd}</span>
        <span className="chip border-amber-400/40 bg-amber-500/10 text-amber-300">Runs on the API host</span>
        {!ended && (
          <button
            type="button"
            onClick={disconnect}
            className="focus-ring console-tap ml-auto inline-flex items-center gap-1.5 text-ink-500 hover:text-ink-100"
          >
            Disconnect
          </button>
        )}
      </div>
      {disconnected && (
        <p className="border-b px-3 py-1 text-[11px] text-ink-400" style={{ borderColor: "var(--c-edge)" }}>
          Disconnected from the shell.{" "}
          <button type="button" className="focus-ring console-tap inline-flex items-center gap-1 text-ink-500 underline underline-offset-2 hover:text-ink-100" onClick={restart}>
            <RotateCcw className="h-3 w-3" aria-hidden /> New session
          </button>
        </p>
      )}
      {!status.pty && (
        <p className="border-b px-3 py-1 text-[11px] text-amber-300" style={{ borderColor: "var(--c-edge)" }}>
          Running without a pseudo-terminal: interactive programs and line editing are limited.
        </p>
      )}
      {exitCode !== undefined && (
        <p className="border-b px-3 py-1 text-[11px] text-ink-400" style={{ borderColor: "var(--c-edge)" }}>
          Shell exited (code {exitCode ?? "unknown"}). <button type="button" className="focus-ring console-tap text-ink-500 underline underline-offset-2 hover:text-ink-100" onClick={restart}>Restart shell</button>
        </p>
      )}
      {errorMessage && (
        <p className="border-b px-3 py-1 text-[11px] text-red-400" style={{ borderColor: "var(--c-edge)" }}>
          {errorMessage} <button type="button" className="focus-ring console-tap text-red-300 underline underline-offset-2 hover:text-ink-100" onClick={restart}>Restart shell</button>
        </p>
      )}
      <div ref={containerRef} className="min-h-0 flex-1 px-2 py-1" data-testid="xterm-container" />
    </div>
  );
}
