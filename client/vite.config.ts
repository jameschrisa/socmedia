/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.VITE_API_PROXY || "http://localhost:4000", ws: true },
      "/uploads": process.env.VITE_API_PROXY || "http://localhost:4000",
    },
    // The e2e run (identified by VITE_API_PROXY, only set by playwright.config.ts) uses its own
    // dev server instance on a dedicated port, but watches the same source tree as any other dev
    // server that happens to be running concurrently. Hot-module-reload pushes from unrelated
    // saves would otherwise abort in-flight requests / remount the app mid-test, so HMR is turned
    // off for that instance; each test navigation still picks up whatever is currently on disk.
    hmr: process.env.VITE_API_PROXY ? false : undefined,
  },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
