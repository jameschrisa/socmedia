import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
// NB: same deliberate deviation as ai.ts — structured() output schemas must be zod v4 for the
// Anthropic SDK's zodOutputFormat() helper.
import { z } from "zod/v4";
import { config } from "../config";
import type { Db } from "../db/database";
import { structured } from "./aiProviders";
import { activeProvider } from "./aiSettings";

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_PER_HOUR = 30;
const submissionTimestamps = new Map<string, number[]>();

/** Generates a fresh quick-post secret (32+ url-safe chars) plus its stored hash and display preview. */
export function generateQuickPostToken(): { secret: string; hash: string; preview: string } {
  const secret = crypto.randomBytes(24).toString("base64url");
  return { secret, hash: hashQuickPostToken(secret), preview: secret.slice(-4) };
}

export function hashQuickPostToken(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/** True (and records the attempt) when `tokenId` is still under the hourly submission limit. */
export function checkAndRecordRateLimit(tokenId: string, now: number = Date.now()): boolean {
  const recent = (submissionTimestamps.get(tokenId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_PER_HOUR) {
    submissionTimestamps.set(tokenId, recent);
    return false;
  }
  recent.push(now);
  submissionTimestamps.set(tokenId, recent);
  return true;
}

/** Test-only: clears rate-limit state between test files. */
export function resetQuickPostRateLimits(): void {
  submissionTimestamps.clear();
}

/** Saves a voice-memo buffer under `<dataDir>/uploads/<orgId>/memos/` and returns its public URL. */
export function saveMemoBuffer(orgId: string, buffer: Buffer, mimeType: string): { url: string; absolutePath: string } {
  const dir = path.join(config.dataDir, "uploads", orgId, "memos");
  fs.mkdirSync(dir, { recursive: true });
  const ext = (mimeType.split("/")[1] || "webm").replace(/[^a-z0-9]/gi, "") || "webm";
  const filename = `${nanoid(12)}.${ext}`;
  const absolutePath = path.join(dir, filename);
  fs.writeFileSync(absolutePath, buffer);
  return { url: `/uploads/${orgId}/memos/${filename}`, absolutePath };
}

const quickCaptionOutputSchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()).max(8),
});

export interface ResolvedQuickCaption {
  caption: string;
  hashtags: string[];
  captionSource: "transcript" | "ai";
}

/**
 * Turns a raw on-device speech-to-text transcript into a post caption. Only calls out to an AI
 * provider when `polish` is requested AND a real provider is configured; otherwise (including the
 * offline mock) the transcript is used as-is, trimmed.
 */
export async function resolveQuickCaption(db: Db, transcript: string, polish: boolean): Promise<ResolvedQuickCaption> {
  const trimmed = transcript.trim();
  if (!polish || activeProvider(db).provider === "mock") {
    return { caption: trimmed, hashtags: [], captionSource: "transcript" };
  }
  const result = await structured(db, {
    schema: quickCaptionOutputSchema,
    schemaName: "quickCaption",
    system:
      "You turn a raw voice-memo transcript into a single on-brand social media caption paragraph, plus up to 8 relevant hashtags (no leading #). Keep the caption natural, not a literal transcription.",
    maxTokens: 500,
    user: `Transcript: ${trimmed}`,
  });
  return { caption: result.data.caption, hashtags: result.data.hashtags, captionSource: "ai" };
}
