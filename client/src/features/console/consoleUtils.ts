import type { LogLevel, LogSource } from "@socmedia/shared";

/** Built-in slash commands, hardcoded from the server's `/help` text. */
export interface BuiltinCommand { command: string; description: string }
export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  { command: "/help", description: "List available commands" },
  { command: "/status", description: "Show scheduler and API health" },
  { command: "/posts", description: "List posts, optionally by status" },
  { command: "/jobs", description: "List recent publish jobs" },
  { command: "/accounts", description: "List connected accounts" },
  { command: "/media", description: "List media assets" },
  { command: "/publish", description: "Publish a post by id" },
  { command: "/retry", description: "Retry a failed job by id" },
  { command: "/logs", description: "Show recent log entries" },
  { command: "/whoami", description: "Show the signed-in user" },
  { command: "/docs", description: "Search platform docs: /docs <platform?> <query>" },
  { command: "/diagnose", description: "Diagnose a connection: /diagnose <connectionId|platform>" },
  { command: "/clear", description: "Clear this console (no request sent)" },
];

/** Commands matching what's typed so far, for the `/` hint line. */
export function matchingCommands(input: string): BuiltinCommand[] {
  const needle = input.trim().toLowerCase();
  if (!needle.startsWith("/")) return [];
  return BUILTIN_COMMANDS.filter((c) => c.command.startsWith(needle));
}

const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;

/** Splits a line of text into plain-text and URL segments, for rendering clickable links. */
export function splitLinkify(text: string): { text: string; isUrl: boolean }[] {
  const parts: { text: string; isUrl: boolean }[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(URL_RE)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) parts.push({ text: text.slice(lastIndex, idx), isUrl: false });
    parts.push({ text: match[0], isUrl: true });
    lastIndex = idx + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), isUrl: false });
  return parts;
}

export const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: "text-ink-400",
  info: "text-ink-700",
  warn: "text-amber-500",
  error: "text-red-500",
};

export interface LogFilterState {
  level: LogLevel | "";
  source: LogSource | "";
  q: string;
}

export const DEFAULT_LOG_FILTERS: LogFilterState = { level: "", source: "", q: "" };

export function matchesTextFilter(message: string, q: string): boolean {
  if (!q.trim()) return true;
  return message.toLowerCase().includes(q.trim().toLowerCase());
}

/** Backoff delay (ms) for the Nth reconnect attempt (0-indexed), capped at 8s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(8000, 1000 * 2 ** attempt);
}
