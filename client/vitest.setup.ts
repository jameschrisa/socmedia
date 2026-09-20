import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => cleanup());

// jsdom lacks these browser APIs used by framer-motion / dnd-kit / konva
if (!("ResizeObserver" in globalThis)) {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
if (!("IntersectionObserver" in globalThis)) {
  (globalThis as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
}
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as any;
}
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || vi.fn();
Element.prototype.scrollTo = Element.prototype.scrollTo || (vi.fn() as any);

// Node 24+ defines its own `localStorage`/`sessionStorage` globals, which win over jsdom's and
// arrive without the Storage methods. Zustand's persist middleware then dies on `storage.setItem`.
// Install a real in-memory Storage whenever the ambient one is unusable.
function installStorage(key: "localStorage" | "sessionStorage"): void {
  const existing = (globalThis as any)[key];
  if (existing && typeof existing.setItem === "function") return;
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() { return entries.size; },
    key: (i: number) => Array.from(entries.keys())[i] ?? null,
    getItem: (k: string) => (entries.has(k) ? entries.get(k)! : null),
    setItem: (k: string, v: string) => { entries.set(String(k), String(v)); },
    removeItem: (k: string) => { entries.delete(k); },
    clear: () => { entries.clear(); },
  };
  Object.defineProperty(globalThis, key, { value: storage, configurable: true, writable: true });
  Object.defineProperty(window, key, { value: storage, configurable: true, writable: true });
}
installStorage("localStorage");
installStorage("sessionStorage");

// jsdom doesn't implement object URLs (used for local photo/video previews).
if (!("createObjectURL" in URL)) {
  (URL as any).createObjectURL = vi.fn(() => "blob:mock-url");
}
if (!("revokeObjectURL" in URL)) {
  (URL as any).revokeObjectURL = vi.fn();
}
