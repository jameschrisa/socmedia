import { PLATFORM_SPECS, type Platform, type PostFormat } from "./platforms";
import type { MediaAsset, Post, PostTarget } from "./types";

export interface ValidationIssue {
  level: "error" | "warning";
  platform?: Platform;
  message: string;
}

/** Extract hashtags from free text (without the leading #). */
export function extractHashtags(text: string): string[] {
  const found = text.match(/#([\p{L}\p{N}_]+)/gu) ?? [];
  return [...new Set(found.map((h) => h.slice(1)))];
}

export function composeCaption(caption: string, hashtags: string[]): string {
  const tags = hashtags.filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`));
  return tags.length ? `${caption.trim()}\n\n${tags.join(" ")}`.trim() : caption.trim();
}

export function effectiveCaption(post: Pick<Post, "caption" | "hashtags">, target: PostTarget): string {
  return composeCaption(target.caption ?? post.caption, target.hashtags ?? post.hashtags);
}

/** Validate a post against each target platform's rules. */
export function validatePost(post: Pick<Post, "caption" | "hashtags" | "mediaIds" | "targets" | "title" | "scheduledAt"> & Partial<Pick<Post, "publishMode">>, media: MediaAsset[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  issues.push(...duplicateCaptionWarnings(post));
  if (post.targets.length === 0) {
    issues.push({ level: "error", message: "Select at least one platform to publish to." });
  }
  const byId = new Map(media.map((m) => [m.id, m]));
  for (const target of post.targets) {
    const spec = PLATFORM_SPECS[target.platform];
    const caption = effectiveCaption(post, target);
    if (caption.length > spec.captionMaxLength) {
      issues.push({ level: "error", platform: target.platform, message: `${spec.name} captions are limited to ${spec.captionMaxLength} characters (currently ${caption.length}).` });
    }
    const tags = target.hashtags ?? post.hashtags;
    if (tags.length > spec.hashtagLimit) {
      issues.push({ level: "warning", platform: target.platform, message: `${spec.name} recommends at most ${spec.hashtagLimit} hashtags (currently ${tags.length}).` });
    }
    if (!spec.formats.includes(target.format)) {
      issues.push({ level: "error", platform: target.platform, message: `${spec.name} does not support the ${target.format} format.` });
    }
    const mediaIds = target.mediaIds.length ? target.mediaIds : post.mediaIds;
    if (spec.requiresMedia && mediaIds.length === 0) {
      issues.push({ level: "error", platform: target.platform, message: `${spec.name} posts need at least one media file.` });
    }
    if (mediaIds.length > spec.maxMediaCount) {
      issues.push({ level: "error", platform: target.platform, message: `${spec.name} allows at most ${spec.maxMediaCount} media items.` });
    }
    for (const id of mediaIds) {
      const asset = byId.get(id);
      if (!asset) continue;
      if (!spec.mediaKinds.includes(asset.kind)) {
        issues.push({ level: "error", platform: target.platform, message: `${spec.name} does not accept ${asset.kind} files (${asset.filename}).` });
      }
      if (asset.kind === "video" && asset.durationSeconds && asset.durationSeconds > spec.maxVideoSeconds) {
        issues.push({ level: "error", platform: target.platform, message: `${spec.name} videos must be under ${Math.round(spec.maxVideoSeconds / 60)} minutes.` });
      }
    }
    if (target.platform === "youtube") {
      const title = target.title ?? post.title;
      if (!title.trim()) issues.push({ level: "error", platform: "youtube", message: "YouTube videos need a title." });
      else if (spec.titleMaxLength && title.length > spec.titleMaxLength) issues.push({ level: "error", platform: "youtube", message: `YouTube titles are limited to ${spec.titleMaxLength} characters.` });
    }
  }
  if (post.scheduledAt && Number.isNaN(Date.parse(post.scheduledAt))) {
    issues.push({ level: "error", message: "Scheduled time is not a valid date." });
  }
  return issues;
}

/**
 * Several accounts on the same platform receiving identical content at the same moment is the
 * classic trigger for duplicate-content throttling. Warn unless each account has its own caption
 * or the post is queued (spaced out).
 */
export function duplicateCaptionWarnings(post: Pick<Post, "caption" | "hashtags" | "targets"> & Partial<Pick<Post, "publishMode">>): ValidationIssue[] {
  const byPlatform = new Map<Platform, PostTarget[]>();
  for (const t of post.targets) byPlatform.set(t.platform, [...(byPlatform.get(t.platform) ?? []), t]);
  const issues: ValidationIssue[] = [];
  for (const [platform, targets] of byPlatform) {
    if (targets.length < 2) continue;
    const captions = new Set(targets.map((t) => effectiveCaption(post, t)));
    if (captions.size < targets.length) {
      const spec = PLATFORM_SPECS[platform];
      issues.push({
        level: "warning",
        platform,
        message: post.publishMode === "queue"
          ? `${targets.length} ${spec.name} accounts share the same caption. They will publish one after another, but consider a per-account variation.`
          : `${targets.length} ${spec.name} accounts will post the identical caption at once. Vary the caption per account or use queue mode to avoid duplicate-content throttling.`,
      });
    }
  }
  return issues;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}

export function defaultFormatFor(platform: Platform): PostFormat {
  return PLATFORM_SPECS[platform].defaultFormat;
}
