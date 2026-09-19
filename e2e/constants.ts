/** Shared constants for the e2e suite: ports, bootstrap owner credentials, and file paths. */
import path from "node:path";

// Playwright always runs from the repo root (see README / task instructions), and this file is
// itself compiled per-test-file rather than bundled, so resolve paths from process.cwd() instead
// of import.meta.url to stay CJS/ESM agnostic.
const root = process.cwd();
const e2eDir = path.resolve(root, "e2e");

export const API_PORT = 4100;
export const WEB_PORT = 5174;
export const API_BASE_URL = `http://localhost:${API_PORT}`;
export const WEB_BASE_URL = `http://localhost:${WEB_PORT}`;

export const OWNER_EMAIL = "qa@suprstar.test";
export const OWNER_PASSWORD = "qa-password-123";
export const OWNER_NAME = "QA";

export const OWNER_STORAGE_STATE = path.resolve(e2eDir, ".auth/owner.json");
export const VIDEO_FIXTURE = path.resolve(e2eDir, "fixtures/clip-6s.mp4");
/** Deliberately over the 300s server/client cap, to exercise the "too long" rejection path. */
export const OVERLONG_VIDEO_FIXTURE = path.resolve(e2eDir, "fixtures/too-long-302s.mp4");
export const DATA_DIR = path.resolve(root, "data/e2e");
