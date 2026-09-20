import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";

export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
}

export function renderWithProviders(ui: ReactElement, { route = "/", client = createTestQueryClient(), ...options }: RenderOptions & { route?: string; client?: QueryClient } = {}) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}>{children}</MemoryRouter></QueryClientProvider>
  );
  return { client, ...render(ui, { wrapper: Wrapper, ...options }) };
}

/** Minimal fetch mock: map "METHOD /api/path" → handler returning JSON (or a Response). */
export function mockFetch(routes: Record<string, (init?: RequestInit, url?: string) => unknown>) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    let body: unknown;
    if (typeof init?.body === "string") { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    calls.push({ method, url, body });
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      if (m !== method) return false;
      const re = new RegExp("^" + p!.replace(/:[^/]+/g, "[^/]+") + "$");
      return re.test(path);
    });
    if (!key) return new Response(JSON.stringify({ error: `No mock for ${method} ${path}` }), { status: 404, headers: { "Content-Type": "application/json" } });
    const result = routes[key]!(init, url);
    if (result instanceof Response) return result;
    if (result === undefined) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(result), { status: method === "POST" ? 200 : 200, headers: { "Content-Type": "application/json" } });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return { fn, calls };
}

type Listener = (ev: { data?: string }) => void;

/** Minimal EventSource stand-in: jsdom has none. Auto-fires "open" on the next tick; tests
 * drive it further with `dispatch("log", entry)` / `dispatch("error")` on the latest instance. */
export class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  withCredentials: boolean;
  private listeners: Record<string, Listener[]> = {};
  closed = false;

  constructor(url: string, opts?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = !!opts?.withCredentials;
    MockEventSource.instances.push(this);
    setTimeout(() => { if (!this.closed) this.dispatch("open"); }, 0);
  }

  addEventListener(type: string, cb: Listener) {
    (this.listeners[type] ??= []).push(cb);
  }

  removeEventListener(type: string, cb: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== cb);
  }

  dispatch(type: string, data?: unknown) {
    const ev = { data: typeof data === "string" || data === undefined ? data : JSON.stringify(data) };
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }

  close() {
    this.closed = true;
  }
}

/** Installs `MockEventSource` as the global `EventSource` for the duration of a test; returns a restore function. */
export function installMockEventSource() {
  const previous = (globalThis as any).EventSource;
  (globalThis as any).EventSource = MockEventSource;
  MockEventSource.instances = [];
  return () => { (globalThis as any).EventSource = previous; };
}

type WsListener = (ev: any) => void;

/** Minimal WebSocket stand-in: jsdom has none. Records everything sent so tests can assert on it,
 * and exposes `dispatchOpen`/`dispatchMessage`/`dispatchClose`/`dispatchError` to drive it from the server side. */
export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  url: string;
  sent: string[] = [];
  closed = false;
  readyState = 0; // CONNECTING
  onopen: WsListener | null = null;
  onmessage: WsListener | null = null;
  onclose: WsListener | null = null;
  onerror: WsListener | null = null;
  private listeners: Record<string, WsListener[]> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: WsListener) {
    (this.listeners[type] ??= []).push(cb);
  }

  removeEventListener(type: string, cb: WsListener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== cb);
  }

  private emit(type: string, ev: any) {
    if (type === "open" && this.onopen) this.onopen(ev);
    if (type === "message" && this.onmessage) this.onmessage(ev);
    if (type === "close" && this.onclose) this.onclose(ev);
    if (type === "error" && this.onerror) this.onerror(ev);
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3; // CLOSED
    this.emit("close", { code: 1000 });
  }

  /** Test hook: simulate the server accepting the connection. */
  dispatchOpen() {
    this.readyState = 1; // OPEN
    this.emit("open", {});
  }

  /** Test hook: simulate a server → client text frame. */
  dispatchMessage(data: unknown) {
    this.emit("message", { data: typeof data === "string" ? data : JSON.stringify(data) });
  }

  dispatchClose() {
    this.closed = true;
    this.readyState = 3;
    this.emit("close", { code: 1000 });
  }

  dispatchError() {
    this.emit("error", {});
  }
}

/** Installs `MockWebSocket` as the global `WebSocket` for the duration of a test; returns a restore function. */
export function installMockWebSocket() {
  const previous = (globalThis as any).WebSocket;
  (globalThis as any).WebSocket = MockWebSocket;
  MockWebSocket.instances = [];
  return () => { (globalThis as any).WebSocket = previous; };
}
