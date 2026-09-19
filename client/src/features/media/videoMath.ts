import { FORMAT_SPECS, type PostFormat } from "@socmedia/shared";

/** Pure helpers for the video trim/crop editor. No DOM, no React: easy to unit test. */

export function clamp(value: number, min: number, max: number): number {
  if (min > max) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * "m:ss" for durations of 10 seconds or more, "m:ss.s" (one decimal) for anything shorter,
 * so short clips can still be trimmed with sub-second precision.
 */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  if (safe < 10) {
    const s = rest.toFixed(1);
    return `${minutes}:${s.padStart(4, "0")}`;
  }
  const whole = Math.floor(rest);
  return `${minutes}:${String(whole).padStart(2, "0")}`;
}

/** Parses "m:ss", "m:ss.s" or a plain seconds value back into seconds. Returns null when unparseable. */
export function parseTimecode(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length === 1) {
    const v = Number(parts[0]);
    return Number.isFinite(v) ? v : null;
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    return m * 60 + s;
  }
  return null;
}

export interface TrimRange {
  start: number;
  end: number;
}

/**
 * Keeps a trim range valid: both handles within [0, duration], and the selection length within
 * [minLength, maxLength]. `start` is treated as the anchor; `end` is moved as needed to satisfy the
 * length limits, which also matches how a "drag the far handle" interaction should feel.
 */
export function clampRange(range: TrimRange, duration: number, maxLength = 300, minLength = 0.5): TrimRange {
  const dur = Math.max(0, Number.isFinite(duration) ? duration : 0);
  let start = clamp(range.start, 0, dur);
  let end = clamp(range.end, 0, dur);
  if (end < start) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  let length = end - start;
  if (length > maxLength) {
    end = start + maxLength;
    if (end > dur) {
      end = dur;
      start = Math.max(0, end - maxLength);
    }
    length = end - start;
  }
  if (length < minLength) {
    end = start + minLength;
    if (end > dur) {
      end = dur;
      start = Math.max(0, end - minLength);
    }
  }
  return { start, end };
}

/** Recommended output pixel size for a format, or null for "Original" (no re-encode target). */
export function frameFor(format: PostFormat | null | undefined): { width: number; height: number } | null {
  if (!format) return null;
  const spec = FORMAT_SPECS[format];
  return { width: spec.width, height: spec.height };
}

export interface CropPreviewStyle {
  objectFit: "cover" | "contain";
  aspectRatio: string;
}

/**
 * CSS for a centred crop preview: when a format is chosen the video should fill the target aspect
 * ratio (object-fit: cover, i.e. a centre crop); with no format ("Original") it should show the
 * whole frame at the source aspect ratio.
 */
export function previewCropStyle(videoW: number, videoH: number, format: PostFormat | null | undefined): CropPreviewStyle {
  if (format) {
    const spec = FORMAT_SPECS[format];
    return { objectFit: "cover", aspectRatio: `${spec.width} / ${spec.height}` };
  }
  if (videoW > 0 && videoH > 0) {
    return { objectFit: "contain", aspectRatio: `${videoW} / ${videoH}` };
  }
  return { objectFit: "contain", aspectRatio: "16 / 9" };
}

/** Converts a pointer's clientX position over a track rect into a time in seconds. */
export function secondsFromPointer(clientX: number, rect: { left: number; width: number }, duration: number): number {
  if (!rect.width) return 0;
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  return ratio * Math.max(0, duration);
}
