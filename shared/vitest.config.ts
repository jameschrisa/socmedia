import { defineConfig } from "vitest/config";

// Pinned to this workspace on purpose. Without a config here, vitest walks up past the repo root
// looking for one and can pick up an unrelated file from the developer's home directory.
export default defineConfig({
  root: __dirname,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
