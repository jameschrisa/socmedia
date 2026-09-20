import crypto from "node:crypto";
import fs from "node:fs";
import { PLATFORM_SPECS, effectiveCaption } from "@socmedia/shared";
import type { ConnectionCredentials, MediaAsset, Post, PostTarget, PlatformConnection } from "@socmedia/shared";
import { resolveMediaPath } from "../services/media";
import type { PlatformAdapter, ProfileInfo, PublishResult } from "./types";
import { PlatformError } from "./types";

const spec = PLATFORM_SPECS.x;
const API = "https://api.x.com/2";

// Simple (non-chunked) image upload is only offered for files at or under this size; larger
// images fall back to the chunked flow just like video.
const SIMPLE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
// X recommends ~4MB APPEND chunks; keep comfortably under any per-request body limit.
const CHUNK_SIZE = 4 * 1024 * 1024;
// Cap total STATUS polling time; X's own processing is usually done well within this.
const MAX_PROCESSING_WAIT_MS = 60_000;

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 code_verifier: 43-128 chars from the unreserved character set. base64url(32 random bytes) is 43 chars. */
function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(32));
}

function codeChallengeFor(verifier: string): string {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

function basicAuthHeader(conn: PlatformConnection): string {
  return `Basic ${Buffer.from(`${conn.credentials.clientId}:${conn.credentials.clientSecret}`).toString("base64")}`;
}

function handleFor(conn: PlatformConnection): string {
  return (conn.handle || "").replace(/^@/, "");
}

/** Shared fetch wrapper: surfaces X's Problem-Details error bodies and turns 429s into a clear, actionable message. */
async function xFetch(url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, init);
  if (res.status === 429) {
    const resetHeader = res.headers.get("x-rate-limit-reset");
    const resetAt = resetHeader ? new Date(Number(resetHeader) * 1000).toISOString() : "an unknown time";
    throw new PlatformError("x", `X rate limit exceeded; it resets at ${resetAt}.`, 429);
  }
  const data = await res.json().catch(() => ({}) as any);
  if (!res.ok) {
    const message =
      data?.detail || data?.title || data?.errors?.[0]?.message || data?.error_description || data?.error || `X request failed (${res.status})`;
    throw new PlatformError("x", message, res.status);
  }
  return data;
}

function prepareAuthorization(_conn: PlatformConnection): { extra: Record<string, string> } {
  return { extra: { codeVerifier: generateCodeVerifier() } };
}

function buildAuthorizeUrl(conn: PlatformConnection, state: string): string {
  const url = new URL(spec.oauth.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", conn.credentials.clientId);
  url.searchParams.set("redirect_uri", conn.credentials.redirectUri);
  url.searchParams.set("scope", (conn.credentials.scopes.length ? conn.credentials.scopes : spec.oauth.scopes).join(" "));
  url.searchParams.set("state", state);
  const verifier = conn.credentials.extra.codeVerifier;
  if (verifier) {
    url.searchParams.set("code_challenge", codeChallengeFor(verifier));
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

async function exchangeCode(conn: PlatformConnection, code: string): Promise<Partial<ConnectionCredentials>> {
  const verifier = conn.credentials.extra.codeVerifier || "";
  const data = await xFetch(spec.oauth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuthHeader(conn) },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: conn.credentials.redirectUri,
      client_id: conn.credentials.clientId,
      code_verifier: verifier,
    }),
  });
  // The verifier is single-use: clear it once the exchange succeeds so it can't be replayed.
  const { codeVerifier: _discard, ...remainingExtra } = conn.credentials.extra;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? conn.credentials.refreshToken,
    tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
    scopes: typeof data.scope === "string" ? data.scope.split(" ") : conn.credentials.scopes,
    extra: remainingExtra,
  };
}

async function refreshToken(conn: PlatformConnection): Promise<Partial<ConnectionCredentials>> {
  const data = await xFetch(spec.oauth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuthHeader(conn) },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.credentials.refreshToken || "",
      client_id: conn.credentials.clientId,
    }),
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? conn.credentials.refreshToken,
    tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : conn.credentials.tokenExpiresAt,
  };
}

async function fetchProfile(conn: PlatformConnection): Promise<ProfileInfo> {
  const data = await xFetch(`${API}/users/me?user.fields=profile_image_url,public_metrics,username`, {
    headers: { Authorization: `Bearer ${conn.credentials.accessToken}` },
  });
  const user = data.data ?? {};
  return {
    displayName: user.name || conn.displayName,
    handle: user.username ? `@${user.username}` : conn.handle,
    avatarUrl: user.profile_image_url ?? conn.avatarUrl,
    followers: user.public_metrics?.followers_count ?? conn.followers,
    extra: { userId: user.id ?? "" },
  };
}

async function testConnection(conn: PlatformConnection) {
  const start = Date.now();
  const scopes = conn.credentials.scopes.length ? conn.credentials.scopes : spec.oauth.scopes;
  const hasTweetWrite = scopes.includes("tweet.write");
  const hasMediaWrite = scopes.includes("media.write");
  const hasToken = !!conn.credentials.accessToken;
  try {
    const profile = await fetchProfile(conn);
    const ok = hasToken && hasTweetWrite && hasMediaWrite;
    return {
      ok,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
      message: ok ? `Connected to X as ${profile.handle}` : "Connected, but missing required scopes for posting.",
      details: [
        { label: "Access token present", ok: hasToken },
        { label: "Scopes include tweet.write", ok: hasTweetWrite },
        { label: "Media upload capability (media.write scope)", ok: hasMediaWrite },
        { label: "Account lookup (GET /2/users/me)", ok: true, info: profile.handle },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "X connection failed";
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
      message,
      details: [
        { label: "Access token present", ok: hasToken },
        { label: "Scopes include tweet.write", ok: hasTweetWrite },
        { label: "Media upload capability (media.write scope)", ok: hasMediaWrite },
        { label: "Account lookup (GET /2/users/me)", ok: false, info: message },
      ],
    };
  }
}

/** Extracts the media id from either the "data"-wrapped or flat shape X's media endpoints return. */
function mediaIdFrom(data: any): string {
  return String(data?.data?.id ?? data?.id ?? data?.media_id_string ?? data?.media_id ?? "");
}

async function uploadImage(conn: PlatformConnection, asset: MediaAsset): Promise<string> {
  const buffer = fs.readFileSync(resolveMediaPath(asset.url));
  if (buffer.length > SIMPLE_UPLOAD_MAX_BYTES) {
    return uploadChunked(conn, asset, buffer, "tweet_image");
  }
  const form = new FormData();
  form.append("media_category", "tweet_image");
  form.append("media", new Blob([new Uint8Array(buffer)], { type: asset.mimeType || "image/jpeg" }), asset.filename || "image");
  const data = await xFetch(`${API}/media/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${conn.credentials.accessToken}` },
    body: form,
  });
  return mediaIdFrom(data);
}

async function pollUntilProcessed(conn: PlatformConnection, mediaId: string, initialCheckAfterSecs?: number): Promise<void> {
  let waited = 0;
  let checkAfterSecs = initialCheckAfterSecs ?? 1;
  while (waited < MAX_PROCESSING_WAIT_MS) {
    const delayMs = Math.min(checkAfterSecs, 5) * 1000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    waited += delayMs;
    const status = await xFetch(`${API}/media/upload?command=STATUS&media_id=${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${conn.credentials.accessToken}` },
    });
    const info = status.data?.processing_info ?? status.processing_info;
    if (!info || info.state === "succeeded") return;
    if (info.state === "failed") {
      throw new PlatformError("x", info.error?.message || "X media processing failed.", 422);
    }
    checkAfterSecs = info.check_after_secs ?? 1;
  }
  throw new PlatformError("x", "X media processing did not finish in time; try again.", 408);
}

async function uploadChunked(conn: PlatformConnection, asset: MediaAsset, buffer: Buffer, mediaCategory: "tweet_image" | "tweet_video"): Promise<string> {
  const initData = await xFetch(`${API}/media/upload/initialize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${conn.credentials.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: asset.mimeType || "video/mp4", media_category: mediaCategory, total_bytes: buffer.length }),
  });
  const mediaId = mediaIdFrom(initData);

  let segmentIndex = 0;
  for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
    const chunk = buffer.subarray(offset, offset + CHUNK_SIZE);
    const form = new FormData();
    form.append("segment_index", String(segmentIndex));
    form.append("media", new Blob([new Uint8Array(chunk)], { type: asset.mimeType || "application/octet-stream" }), asset.filename || "media");
    await xFetch(`${API}/media/upload/${encodeURIComponent(mediaId)}/append`, {
      method: "POST",
      headers: { Authorization: `Bearer ${conn.credentials.accessToken}` },
      body: form,
    });
    segmentIndex += 1;
  }

  const finalizeData = await xFetch(`${API}/media/upload/${encodeURIComponent(mediaId)}/finalize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${conn.credentials.accessToken}` },
  });
  const processingInfo = finalizeData.data?.processing_info ?? finalizeData.processing_info;
  if (processingInfo && processingInfo.state !== "succeeded") {
    await pollUntilProcessed(conn, mediaId, processingInfo.check_after_secs);
  }
  return mediaId;
}

async function uploadMedia(conn: PlatformConnection, asset: MediaAsset): Promise<string> {
  if (asset.kind === "video") {
    const buffer = fs.readFileSync(resolveMediaPath(asset.url));
    return uploadChunked(conn, asset, buffer, "tweet_video");
  }
  return uploadImage(conn, asset);
}

async function publish(conn: PlatformConnection, post: Post, target: PostTarget, media: MediaAsset[]): Promise<PublishResult> {
  const caption = effectiveCaption(post, target);
  if (caption.length > spec.captionMaxLength) {
    throw new PlatformError("x", `X posts are limited to ${spec.captionMaxLength} characters (currently ${caption.length}).`);
  }
  const videos = media.filter((m) => m.kind === "video");
  const images = media.filter((m) => m.kind === "image");
  if (videos.length > 1 || (videos.length === 1 && images.length > 0)) {
    throw new PlatformError("x", "X posts can include either up to 4 images or a single video, not both.");
  }
  if (images.length > spec.maxMediaCount) {
    throw new PlatformError("x", `X posts allow at most ${spec.maxMediaCount} images.`);
  }

  const mediaIds: string[] = [];
  for (const asset of media) {
    mediaIds.push(await uploadMedia(conn, asset));
  }

  const body: Record<string, unknown> = { text: caption };
  if (mediaIds.length > 0) body.media = { media_ids: mediaIds };

  const data = await xFetch(`${API}/tweets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${conn.credentials.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const id = data.data?.id;
  if (!id) throw new PlatformError("x", "X did not return a post id.");
  return { externalId: id, externalUrl: `https://x.com/${handleFor(conn) || "i"}/status/${id}` };
}

async function fetchMetrics(conn: PlatformConnection, days: number) {
  let userId = conn.credentials.extra.userId;
  let followers = conn.followers;
  try {
    const profile = await fetchProfile(conn);
    followers = profile.followers;
    userId = profile.extra?.userId || userId;
  } catch {
    // fall back to whatever we already have on the connection; the caller will see followers unchanged
  }
  if (!userId) return [];

  const data = await xFetch(`${API}/users/${encodeURIComponent(userId)}/tweets?tweet.fields=public_metrics,created_at&max_results=100`, {
    headers: { Authorization: `Bearer ${conn.credentials.accessToken}` },
  });
  const tweets: any[] = data.data ?? [];
  const cutoff = Date.now() - days * 86_400_000;

  const byDate = new Map<string, { impressions: number; likes: number; comments: number; shares: number; saves: number }>();
  for (const tweet of tweets) {
    const createdAt = tweet.created_at ? Date.parse(tweet.created_at) : NaN;
    if (Number.isNaN(createdAt) || createdAt < cutoff) continue;
    const date = tweet.created_at.slice(0, 10);
    const m = tweet.public_metrics ?? {};
    const bucket = byDate.get(date) ?? { impressions: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
    bucket.impressions += m.impression_count ?? 0;
    bucket.likes += m.like_count ?? 0;
    bucket.comments += m.reply_count ?? 0;
    bucket.shares += m.retweet_count ?? 0;
    bucket.saves += (m.quote_count ?? 0) + (m.bookmark_count ?? 0);
    byDate.set(date, bucket);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, m]) => ({
      date,
      followers,
      impressions: m.impressions,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      saves: m.saves,
      engagementRate: m.impressions > 0 ? Number(((m.likes + m.comments + m.shares + m.saves) / m.impressions).toFixed(4)) : 0,
    }));
}

export const xAdapter: PlatformAdapter = {
  prepareAuthorization,
  buildAuthorizeUrl,
  exchangeCode,
  refreshToken,
  fetchProfile,
  testConnection,
  publish,
  fetchMetrics,
};
