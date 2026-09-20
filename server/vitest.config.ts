import { defineConfig } from "vitest/config";

process.env.NODE_ENV = process.env.NODE_ENV || "test";
// Off by default so ordinary tests never write backup archives; backup.test.ts flips it on where needed.
process.env.BACKUP_ENABLED = process.env.BACKUP_ENABLED || "false";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
