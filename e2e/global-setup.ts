import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { DATA_DIR, OVERLONG_VIDEO_FIXTURE, QUICK_PHOTO_FIXTURE, VIDEO_FIXTURE } from "./constants";

const root = process.cwd();

/**
 * Runs once before any webServer starts / test runs:
 *  - wipes the e2e data directory so every run starts from a clean database + upload folder
 *  - renders the small real MP4 fixture used by the video upload/clip tests, if it isn't already there
 */
export default async function globalSetup(): Promise<void> {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  fs.mkdirSync(path.dirname(VIDEO_FIXTURE), { recursive: true });
  if (!fs.existsSync(VIDEO_FIXTURE)) {
    const ffmpegPath = require("ffmpeg-static") as string;
    execFileSync(ffmpegPath, [
      "-y",
      "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15",
      "-f", "lavfi", "-i", "sine=frequency=440",
      "-t", "6",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      VIDEO_FIXTURE,
    ], { stdio: "inherit" });
  }

  fs.mkdirSync(path.dirname(QUICK_PHOTO_FIXTURE), { recursive: true });
  if (!fs.existsSync(QUICK_PHOTO_FIXTURE)) {
    // Resolved from the server workspace (where the "sharp" dependency is actually declared)
    // rather than a bare `require("sharp")` from this file's own location, so this keeps working
    // regardless of whether npm's hoisting happens to also put a copy at the repo root.
    const requireFromServer = createRequire(path.join(root, "server/package.json"));
    const sharp = requireFromServer("sharp") as typeof import("sharp");
    await sharp({
      create: { width: 1080, height: 1080, channels: 3, background: { r: 90, g: 140, b: 200 } },
    })
      .jpeg()
      .toFile(QUICK_PHOTO_FIXTURE);
  }

  if (!fs.existsSync(OVERLONG_VIDEO_FIXTURE)) {
    const ffmpegPath = require("ffmpeg-static") as string;
    // Tiny frame size + ultrafast preset keeps this well under a second to render even
    // though it's a 302s (over the 300s cap) clip.
    execFileSync(ffmpegPath, [
      "-y",
      "-f", "lavfi", "-i", "testsrc=size=64x64:rate=8",
      "-t", "302",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-an",
      OVERLONG_VIDEO_FIXTURE,
    ], { stdio: "inherit" });
  }
}
