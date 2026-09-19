import type { Platform } from "@socmedia/shared";
import { PLATFORM_SPECS } from "@socmedia/shared";
import { cn } from "@/lib/utils";
import { platformColor } from "../analyticsUtils";

/** Small coloured dot for platform legends/rows, TikTok uses a readable dark grey instead of near-black. */
export function PlatformDot({ platform, className }: { platform: Platform; className?: string }) {
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)} style={{ background: platformColor(platform) }} aria-label={PLATFORM_SPECS[platform].name} />;
}
