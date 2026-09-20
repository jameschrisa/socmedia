import { spawn as spawnChild } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import type { TerminalStatus } from "@socmedia/shared";
import type { User } from "@socmedia/shared";
import { config } from "../config";

const MAX_SESSIONS_PER_USER = 3;
const MAX_TOTAL_SESSIONS = 10;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Minimal shape both the real pty and the pipe fallback implement. */
interface ShellProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface TerminalSessionHandle {
  id: string;
  /** True when this session runs in a real pseudo-terminal; false for the pipe fallback. */
  pty: boolean;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type CreateTerminalSessionResult = { ok: true; session: TerminalSessionHandle } | { ok: false; reason: string };

interface Session {
  id: string;
  userId: string;
  proc: ShellProcess;
  idleTimer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, Session>();
const sessionsByUser = new Map<string, Set<string>>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ptyModulePromise: Promise<any> | null = null;
/** Set to false the first time node-pty loads but cannot fork a pty on this host, so status stops promising one. */
let ptyUsable: boolean | null = null;

/** Lazily (and only once) attempts to load the optional native `node-pty` dependency. Never throws. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadPty(): Promise<any> {
  if (!ptyModulePromise) {
    ptyModulePromise = import("node-pty").catch(() => null);
  }
  return ptyModulePromise;
}

function defaultShell(): string {
  if (process.env.SHELL) return process.env.SHELL;
  if (process.platform === "darwin") return "/bin/zsh";
  if (process.platform === "linux") return "/bin/bash";
  if (process.platform === "win32") return "powershell.exe";
  return "/bin/sh";
}

/** Working directory for new sessions: the parent of DATA_DIR (i.e. the repo/app root), falling back to cwd. */
function terminalCwd(): string {
  try {
    return path.dirname(config.dataDir) || process.cwd();
  } catch {
    return process.cwd();
  }
}

/** Enabled when the OS_TERMINAL feature flag is on and the caller is an owner or admin. Synchronous: does not probe for node-pty. */
export function terminalEnabled(user: User): boolean {
  if (config.osTerminal !== "on") return false;
  return user.role === "owner" || user.role === "admin";
}

/** Full status payload for the client, including why the terminal is disabled (if it is) and whether a real pty is available. */
export async function terminalStatus(user: User): Promise<TerminalStatus> {
  const pty = await loadPty();
  const base = {
    platform: process.platform,
    shell: defaultShell(),
    hostname: os.hostname(),
    user: os.userInfo().username,
    cwd: terminalCwd(),
    pty: !!pty && ptyUsable !== false,
  };
  if (config.osTerminal !== "on") {
    return { ...base, enabled: false, reason: "The OS terminal is disabled on this deployment. Set OS_TERMINAL=on to enable it." };
  }
  if (user.role !== "owner" && user.role !== "admin") {
    return { ...base, enabled: false, reason: "Only owners and admins can use the OS terminal." };
  }
  return { ...base, enabled: true, reason: null };
}

/** Test/diagnostic helper: how many sessions are currently open, in total and for one user. */
export function terminalSessionCounts(userId?: string): { total: number; forUser: number } {
  return { total: sessions.size, forUser: userId ? sessionsByUser.get(userId)?.size ?? 0 : 0 };
}

function untrack(id: string, userId: string): void {
  const existing = sessions.get(id);
  if (existing) clearTimeout(existing.idleTimer);
  sessions.delete(id);
  sessionsByUser.get(userId)?.delete(id);
}

export interface CreateTerminalSessionOptions {
  userId: string;
  cols: number;
  rows: number;
  onOutput: (data: string) => void;
  onExit: (code: number | null) => void;
}

/**
 * Spawns a login shell for a terminal session: a real pseudo-terminal via `node-pty` when the optional
 * native module built successfully, otherwise a plain `child_process.spawn` with piped stdio (line
 * editing, resize and signals are limited in that fallback). Enforces the per-user and total
 * concurrency caps and a 30-minute idle timeout (reset on any input or output).
 */
export async function createTerminalSession(opts: CreateTerminalSessionOptions): Promise<CreateTerminalSessionResult> {
  const forUser = sessionsByUser.get(opts.userId)?.size ?? 0;
  if (forUser >= MAX_SESSIONS_PER_USER) {
    return { ok: false, reason: `You already have ${MAX_SESSIONS_PER_USER} terminal sessions open. Close one and try again.` };
  }
  if (sessions.size >= MAX_TOTAL_SESSIONS) {
    return { ok: false, reason: "The server has reached its maximum number of concurrent terminal sessions. Try again shortly." };
  }

  const id = nanoid();
  const cwd = terminalCwd();
  const shell = defaultShell();
  const pty = await loadPty();

  let idleTimer: ReturnType<typeof setTimeout>;
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => proc?.kill(), IDLE_TIMEOUT_MS);
  };

  /** Plain `child_process` pipes: the fallback when node-pty is missing or fails to actually spawn (e.g. no /dev/ptmx access). */
  function spawnPipeFallback(): ShellProcess {
    const args = process.platform === "win32" ? [] : ["-i"];
    const child = spawnChild(shell, args, {
      cwd,
      env: { ...process.env, TERM: "xterm-256color" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      resetIdleTimer();
      opts.onOutput(chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      resetIdleTimer();
      opts.onOutput(chunk.toString("utf8"));
    });
    child.on("exit", (code) => {
      untrack(id, opts.userId);
      opts.onExit(code);
    });
    queueMicrotask(() => {
      opts.onOutput(
        "\r\n[suprstar] No native pty available on this host; using a plain pipe shell. Line editing (arrow keys, tab completion, job control) is limited.\r\n"
      );
    });
    return {
      write: (data) => {
        child.stdin?.write(data);
      },
      // Pipes have no concept of a terminal size; resize is a no-op in the fallback.
      resize: () => {},
      kill: () => {
        child.kill();
      },
    };
  }

  let proc: ShellProcess | undefined;
  let usingPty = false;

  if (pty && ptyUsable !== false) {
    try {
      const ptyProcess = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: opts.cols,
        rows: opts.rows,
        cwd,
        env: { ...process.env, TERM: "xterm-256color" },
      });
      ptyProcess.onData((data: string) => {
        resetIdleTimer();
        opts.onOutput(data);
      });
      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        untrack(id, opts.userId);
        opts.onExit(exitCode);
      });
      proc = {
        write: (data) => ptyProcess.write(data),
        resize: (cols, rows) => ptyProcess.resize(cols, rows),
        kill: () => ptyProcess.kill(),
      };
      usingPty = true;
      ptyUsable = true;
    } catch {
      // node-pty loaded but couldn't actually fork a pty here (sandboxed host, no /dev/ptmx, etc).
      ptyUsable = false;
      proc = spawnPipeFallback();
    }
  } else {
    proc = spawnPipeFallback();
  }

  const spawned: ShellProcess = proc;
  idleTimer = setTimeout(() => spawned.kill(), IDLE_TIMEOUT_MS);
  const session: Session = { id, userId: opts.userId, proc: spawned, idleTimer };
  sessions.set(id, session);
  if (!sessionsByUser.has(opts.userId)) sessionsByUser.set(opts.userId, new Set());
  sessionsByUser.get(opts.userId)!.add(id);

  const handle: TerminalSessionHandle = {
    id,
    pty: usingPty,
    write: (data) => {
      resetIdleTimer();
      spawned.write(data);
    },
    resize: (cols, rows) => spawned.resize(cols, rows),
    kill: () => {
      untrack(id, opts.userId);
      spawned.kill();
    },
  };
  return { ok: true, session: handle };
}

/** Test-only: kills every live session's process and clears all bookkeeping, so tests stay isolated. */
export function _resetTerminalSessionsForTests(): void {
  for (const session of sessions.values()) {
    clearTimeout(session.idleTimer);
    try {
      session.proc.kill();
    } catch {
      // best effort
    }
  }
  sessions.clear();
  sessionsByUser.clear();
}
