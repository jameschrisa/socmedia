import type { Platform } from "@socmedia/shared";
import type { PlatformAdapter } from "./types";
import { tiktokAdapter } from "./tiktok";
import { youtubeAdapter } from "./youtube";
import { linkedinAdapter } from "./linkedin";
import { instagramAdapter } from "./instagram";
import { xAdapter } from "./x";
import { sandboxWrap } from "./sandbox";

export { PlatformError } from "./types";
export type { PlatformAdapter, ProfileInfo, PublishResult } from "./types";

const REAL_ADAPTERS: Record<Platform, PlatformAdapter> = {
  tiktok: tiktokAdapter,
  youtube: youtubeAdapter,
  linkedin: linkedinAdapter,
  instagram: instagramAdapter,
  x: xAdapter,
};

const ADAPTERS: Record<Platform, PlatformAdapter> = {
  tiktok: sandboxWrap(REAL_ADAPTERS.tiktok, "tiktok"),
  youtube: sandboxWrap(REAL_ADAPTERS.youtube, "youtube"),
  linkedin: sandboxWrap(REAL_ADAPTERS.linkedin, "linkedin"),
  instagram: sandboxWrap(REAL_ADAPTERS.instagram, "instagram"),
  x: sandboxWrap(REAL_ADAPTERS.x, "x"),
};

/** Returns the sandbox-aware adapter for a platform: live calls when mode==="live", simulated otherwise. */
export function getAdapter(platform: Platform): PlatformAdapter {
  return ADAPTERS[platform];
}
