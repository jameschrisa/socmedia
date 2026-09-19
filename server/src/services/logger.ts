import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { LogEntry, LogFileInfo, LogLevel, LogSource } from "@socmedia/shared";
import { config } from "../config";

const RING_SIZE = 2000;
const RETENTION_DAYS = 14;
const SECRET_KEY_MARKERS = ["password", "token", "secret", "apikey"];
const LOG_FILE_RE = /^app-(\d{4})-(\d{2})-(\d{2})\.log$/;

export interface LogFields {
  orgId?: string | null;
  userId?: string | null;
  data?: Record<string, unknown> | null;
}

export interface LogQuery {
  limit?: number;
  level?: LogLevel;
  source?: LogSource;
  since?: string;
  q?: string;
}

type Listener = (entry: LogEntry) => void;

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_KEY_MARKERS.some((marker) => lower.includes(marker));
}

/** Deep-redacts any field whose name looks like a secret (password/token/secret/apiKey, case-insensitive). */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

/**
 * Process-wide activity log: an in-memory ring buffer (for the console UI / SSE stream) plus
 * newline-delimited JSON files on disk under `<dataDir>/logs/app-YYYY-MM-DD.log`, one per calendar
 * day. Every entry is also printed to stdout as JSON so hosting platforms that only capture stdout
 * (e.g. Render) still see everything.
 */
class Logger {
  private ring: LogEntry[] = [];
  private listeners = new Set<Listener>();

  private logDir(): string {
    return path.join(config.dataDir, "logs");
  }

  private appendToFile(entry: LogEntry): void {
    try {
      const dir = this.logDir();
      fs.mkdirSync(dir, { recursive: true });
      const date = entry.at.slice(0, 10);
      const file = path.join(dir, `app-${date}.log`);
      fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
    } catch {
      // Logging must never throw or take the process down.
    }
  }

  private emit(level: LogLevel, source: LogSource, message: string, fields?: LogFields): LogEntry {
    const entry: LogEntry = {
      id: nanoid(),
      at: new Date().toISOString(),
      level,
      source,
      message,
      orgId: fields?.orgId ?? null,
      userId: fields?.userId ?? null,
      data: (redact(fields?.data ?? null) as Record<string, unknown> | null) ?? null,
    };
    this.ring.push(entry);
    if (this.ring.length > RING_SIZE) this.ring.splice(0, this.ring.length - RING_SIZE);
    this.appendToFile(entry);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // A broken subscriber (e.g. a dead SSE connection) must not break logging for everyone else.
      }
    }
    return entry;
  }

  debug(source: LogSource, message: string, fields?: LogFields): LogEntry {
    return this.emit("debug", source, message, fields);
  }
  info(source: LogSource, message: string, fields?: LogFields): LogEntry {
    return this.emit("info", source, message, fields);
  }
  warn(source: LogSource, message: string, fields?: LogFields): LogEntry {
    return this.emit("warn", source, message, fields);
  }
  error(source: LogSource, message: string, fields?: LogFields): LogEntry {
    return this.emit("error", source, message, fields);
  }

  /** Subscribes to every new entry (used by the SSE stream); returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Recent entries from the in-memory ring buffer, filtered, newest last (chronological order). */
  recent(query: LogQuery = {}): LogEntry[] {
    let entries = this.ring;
    if (query.level) entries = entries.filter((e) => e.level === query.level);
    if (query.source) entries = entries.filter((e) => e.source === query.source);
    if (query.since) {
      const since = Date.parse(query.since);
      if (Number.isFinite(since)) entries = entries.filter((e) => Date.parse(e.at) >= since);
    }
    if (query.q) {
      const needle = query.q.toLowerCase();
      entries = entries.filter((e) => e.message.toLowerCase().includes(needle));
    }
    const limit = query.limit ?? 200;
    return entries.slice(Math.max(0, entries.length - limit));
  }

  /** Metadata for every on-disk log file, newest first. */
  listFiles(): LogFileInfo[] {
    const dir = this.logDir();
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => LOG_FILE_RE.test(n));
    } catch {
      return [];
    }
    const files = names.map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    });
    files.sort((a, b) => (a.name < b.name ? 1 : -1));
    return files;
  }

  /** Last `tail` lines of a given log file (name must already be validated by the caller). */
  readFileTail(name: string, tail: number): { name: string; size: number; lines: string[] } | undefined {
    const filePath = path.join(this.logDir(), name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return undefined;
    }
    const content = fs.readFileSync(filePath, "utf8");
    const allLines = content.split("\n").filter((l) => l.length > 0);
    const lines = allLines.slice(Math.max(0, allLines.length - tail));
    return { name, size: stat.size, lines };
  }

  /** Deletes log files older than the retention window. Safe to call repeatedly; call once at startup. */
  pruneOldFiles(now: Date = new Date()): void {
    const dir = this.logDir();
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of names) {
      const match = LOG_FILE_RE.exec(name);
      if (!match) continue;
      const fileDate = Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
      if (Number.isFinite(fileDate) && fileDate < cutoff) {
        try {
          fs.unlinkSync(path.join(dir, name));
        } catch {
          // best effort
        }
      }
    }
  }
}

export const log = new Logger();
