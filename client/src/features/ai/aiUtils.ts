import type { AiTone, ContentIdea } from "@socmedia/shared";
import type { AiTabId } from "./aiStore";

/** The five AI Assistant tabs, addressable by hash (`/assistant#captions`, `/assistant#best-times`, etc). */
export const ASSISTANT_TAB_HASH: Record<AiTabId, string> = {
  captions: "#captions",
  ideas: "#ideas",
  hashtags: "#hashtags",
  improve: "#improve",
  bestTimes: "#best-times",
};

export const ASSISTANT_TAB_FOR_HASH: Record<string, AiTabId> = {
  "#captions": "captions",
  "#ideas": "ideas",
  "#hashtags": "hashtags",
  "#improve": "improve",
  "#best-times": "bestTimes",
};

const TONE_LABELS: Record<AiTone, string> = {
  professional: "Professional",
  casual: "Casual",
  playful: "Playful",
  inspirational: "Inspirational",
  educational: "Educational",
  bold: "Bold",
};

/** Friendly, human label for an AiTone value. */
export function toneLabel(tone: AiTone): string {
  return TONE_LABELS[tone] ?? tone;
}

export type CharStatus = "ok" | "warn" | "over";

/** Traffic-light status for a caption/hashtag length against a platform limit. */
export function charStatus(len: number, limit: number): CharStatus {
  if (limit <= 0) return "ok";
  if (len > limit) return "over";
  if (len >= limit * 0.9) return "warn";
  return "ok";
}

/** Turns a content idea into a one-line caption brief. */
export function buildBriefFromIdea(idea: Pick<ContentIdea, "title" | "hook">): string {
  return `${idea.title}: ${idea.hook}`;
}

/**
 * The next date/time (local time) matching the given weekday (0=Sun..6=Sat) and hour,
 * guaranteed to be strictly after `now`.
 */
export function nextOccurrence(weekday: number, hour: number, now: Date = new Date()): Date {
  const result = new Date(now);
  result.setHours(hour, 0, 0, 0);
  const dayDiff = (weekday - result.getDay() + 7) % 7;
  result.setDate(result.getDate() + dayDiff);
  if (result.getTime() <= now.getTime()) {
    result.setDate(result.getDate() + 7);
  }
  return result;
}
