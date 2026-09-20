import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
// NB: same deliberate deviation as ai.ts — structured() output schemas must be zod v4 for the
// Anthropic SDK's zodOutputFormat() helper.
import { z } from "zod/v4";
import { PLATFORM_SPECS } from "@socmedia/shared";
import type { MediaAsset, Platform, Post, PostFormat, PostStatus, PublishMode, QuickPostLink } from "@socmedia/shared";
import { config } from "../config";
import type { Db } from "../db/database";
import { ConnectionsRepo } from "../db/repositories/connections";
import { MediaRepo } from "../db/repositories/media";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { PostsRepo } from "../db/repositories/posts";
import { saveUploadBuffer } from "./media";
import { structured } from "./aiProviders";
import { activeProvider } from "./aiSettings";
import { publishPost } from "./publisher";

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

/** A platform can receive a quick post (always a still photo) only when it accepts an image at all. */
export const acceptsImage = (platform: Platform): boolean => PLATFORM_SPECS[platform].mediaKinds.includes("image");

export interface QuickPostTarget {
  connectionId: string;
  platform: Platform;
  format: PostFormat;
  mediaIds: string[];
}

/**
 * Resolves the accounts a quick post (from the phone page or an inbound binding) should publish to:
 * every enabled image-capable connection, narrowed to `connectionIds` when it is non-empty.
 */
export function resolveQuickTargets(db: Db, orgId: string, connectionIds: string[]): QuickPostTarget[] {
  const connectionsRepo = new ConnectionsRepo(db);
  const all = connectionsRepo.listByOrg(orgId).filter((c) => c.enabled && acceptsImage(c.platform));
  const chosen = connectionIds.length > 0 ? all.filter((c) => connectionIds.includes(c.id)) : all;
  return chosen.map((c) => ({ connectionId: c.id, platform: c.platform, format: PLATFORM_SPECS[c.platform].formats[0], mediaIds: [] }));
}

/** Saves an uploaded photo (buffer) as a MediaAsset, tagged with where it came from. Reused by both quick-post flows. */
export async function saveQuickPostImage(
  db: Db,
  orgId: string,
  buffer: Buffer,
  mimeType: string,
  source: "quick" | "inbound",
  filename?: string
): Promise<MediaAsset> {
  const mediaRepo = new MediaRepo(db);
  const now = new Date().toISOString();
  const saved = await saveUploadBuffer(orgId, buffer, mimeType, filename);
  return mediaRepo.create({
    id: nanoid(),
    orgId,
    kind: saved.kind,
    filename: saved.filename,
    mimeType: saved.mimeType,
    size: saved.size,
    width: saved.width ?? null,
    height: saved.height ?? null,
    durationSeconds: null,
    url: saved.url,
    thumbnailUrl: saved.thumbnailUrl ?? null,
    tags: [source],
    sourceAssetId: null,
    format: null,
    createdAt: now,
  });
}

export interface PublishQuickPostFromMediaInput {
  db: Db;
  orgId: string;
  mediaId: string;
  caption: string;
  hashtags?: string[];
  notes?: string;
  connectionIds: string[];
  publishMode: PublishMode;
  labels?: string[];
}

/**
 * Creates a draft post around an already-saved image and publishes it immediately. Used both by
 * createAndPublishQuickPost() below and by inbound's confirm-before-posting "yes" flow, where the
 * image was saved earlier (at the awaiting_confirmation step) and only needs publishing now.
 */
export async function publishQuickPostFromMedia(
  input: PublishQuickPostFromMediaInput
): Promise<{ post: Post; media: MediaAsset; links: QuickPostLink[] }> {
  const { db, orgId } = input;
  const mediaRepo = new MediaRepo(db);
  const postsRepo = new PostsRepo(db);
  const connectionsRepo = new ConnectionsRepo(db);
  const orgsRepo = new OrganizationsRepo(db);
  const media = mediaRepo.get(input.mediaId);
  if (!media) throw new Error(`Media ${input.mediaId} not found`);

  const now = new Date().toISOString();
  const timezone = orgsRepo.get(orgId)?.timezone || "UTC";
  const targets = resolveQuickTargets(db, orgId, input.connectionIds);

  const draft: Post = postsRepo.create({
    id: nanoid(),
    orgId,
    title: input.caption.slice(0, 60),
    caption: input.caption,
    hashtags: input.hashtags ?? [],
    mediaIds: [media.id],
    targets,
    status: "draft",
    scheduledAt: null,
    timezone,
    publishMode: input.publishMode,
    queueSpacingMinutes: 10,
    labels: input.labels ?? ["quick"],
    notes: input.notes ?? "",
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  });

  const { post: publishedPost, jobs } = await publishPost(db, draft);
  const connections = connectionsRepo.listByOrg(orgId);
  const labelById = new Map(connections.map((c) => [c.id, c.label || null]));
  const jobByConnection = new Map(jobs.map((j) => [j.connectionId, j]));
  const links: QuickPostLink[] = targets.map((t) => {
    const job = jobByConnection.get(t.connectionId);
    return {
      connectionId: t.connectionId,
      platform: t.platform,
      label: labelById.get(t.connectionId) ?? null,
      status: job?.status ?? "queued",
      url: job?.externalUrl ?? null,
      error: job?.error ?? null,
    };
  });

  return { post: publishedPost, media, links };
}

export interface CreateAndPublishQuickPostInput {
  db: Db;
  orgId: string;
  userId: string;
  imageBuffer: Buffer;
  imageMimeType: string;
  imageFilename?: string;
  /** Already-resolved caption; "" (after trimming) means "no caption yet" and creates a draft instead of publishing. */
  caption: string;
  hashtags?: string[];
  notes?: string;
  connectionIds: string[];
  publishMode: PublishMode;
  labels?: string[];
  /** Where this post came from, recorded as a post label and media tag. */
  source: "quick" | "inbound";
}

export interface CreateAndPublishQuickPostResult {
  post: Post;
  media: MediaAsset;
  status: PostStatus | "needs_caption";
  links: QuickPostLink[];
}

/**
 * Shared "photo + caption -> published post" flow used by both the phone quick-post page
 * (routes/quick.ts) and inbound chat messaging (services/inbound.ts): saves the image, resolves
 * targets, and either creates a draft awaiting a caption or publishes through publishPost().
 */
export async function createAndPublishQuickPost(input: CreateAndPublishQuickPostInput): Promise<CreateAndPublishQuickPostResult> {
  const { db, orgId } = input;
  const postsRepo = new PostsRepo(db);
  const orgsRepo = new OrganizationsRepo(db);
  const now = new Date().toISOString();
  const timezone = orgsRepo.get(orgId)?.timezone || "UTC";
  const labels = input.labels ?? [input.source];

  const media = await saveQuickPostImage(db, orgId, input.imageBuffer, input.imageMimeType, input.source, input.imageFilename);
  const caption = input.caption.trim();

  if (!caption) {
    const targets = resolveQuickTargets(db, orgId, input.connectionIds);
    const post = postsRepo.create({
      id: nanoid(),
      orgId,
      title: "",
      caption: "",
      hashtags: [],
      mediaIds: [media.id],
      targets,
      status: "draft",
      scheduledAt: null,
      timezone,
      publishMode: input.publishMode,
      queueSpacingMinutes: 10,
      labels,
      notes: input.notes ?? "Needs a caption",
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    });
    return { post, media, status: "needs_caption", links: [] };
  }

  const { post: publishedPost, links } = await publishQuickPostFromMedia({
    db,
    orgId,
    mediaId: media.id,
    caption,
    hashtags: input.hashtags,
    notes: input.notes,
    connectionIds: input.connectionIds,
    publishMode: input.publishMode,
    labels,
  });
  return { post: publishedPost, media, status: publishedPost.status, links };
}
