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

// jsdom doesn't implement object URLs (used for local photo/video previews).
if (!("createObjectURL" in URL)) {
  (URL as any).createObjectURL = vi.fn(() => "blob:mock-url");
}
if (!("revokeObjectURL" in URL)) {
  (URL as any).revokeObjectURL = vi.fn();
}
