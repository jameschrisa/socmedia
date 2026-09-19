import fs from "node:fs";
import { PLATFORM_SPECS, effectiveCaption } from "@socmedia/shared";
import type { ConnectionCredentials, MediaAsset, Post, PostTarget, PlatformConnection } from "@socmedia/shared";
import { resolveMediaPath } from "../services/media";
import type { PlatformAdapter, ProfileInfo, PublishResult } from "./types";
import { PlatformError } from "./types";

const spec = PLATFORM_SPECS.youtube;

function buildAuthorizeUrl(conn: PlatformConnection, state: string): string {
  const url = new URL(spec.oauth.authorizeUrl);
  url.searchParams.set("client_id", conn.credentials.clientId);
  url.searchParams.set("redirect_uri", conn.credentials.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", (conn.credentials.scopes.length ? conn.credentials.scopes : spec.oauth.scopes).join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCode(conn: PlatformConnection, code: string): Promise<Partial<ConnectionCredentials>> {
  const res = await fetch(spec.oauth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: conn.credentials.clientId,
      client_secret: conn.credentials.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: conn.credentials.redirectUri,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data.error) {
    throw new PlatformError("youtube", data.error_description || data.error || `YouTube token exchange failed (${res.status})`, res.status);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? conn.credentials.refreshToken,
    tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  };
}

async function refreshToken(conn: PlatformConnection): Promise<Partial<ConnectionCredentials>> {
  const res = await fetch(spec.oauth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: conn.credentials.clientId,
      client_secret: conn.credentials.clientSecret,
      grant_type: "refresh_token",
      refresh_token: conn.credentials.refreshToken || "",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data.error) {
    throw new PlatformError("youtube", data.error_description || data.error || `YouTube token refresh failed (${res.status})`, res.status);
  }
  return {
    accessToken: data.access_token,
    tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : conn.credentials.tokenExpiresAt,
  };
}

async function fetchProfile(conn: PlatformConnection): Promise<ProfileInfo> {
  const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true", {
    headers: { Authorization: `Bearer ${conn.credentials.accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data.error) {
    throw new PlatformError("youtube", data.error?.message || `YouTube profile fetch failed (${res.status})`, res.status);
  }
  const channel = data.items?.[0];
  if (!channel) throw new PlatformError("youtube", "No YouTube channel found for this account.");
  return {
    displayName: channel.snippet?.title || conn.displayName,
    handle: channel.snippet?.customUrl ? `@${channel.snippet.customUrl.replace(/^@/, "")}` : conn.handle,
    avatarUrl: channel.snippet?.thumbnails?.default?.url ?? conn.avatarUrl,
    followers: Number(channel.statistics?.subscriberCount ?? conn.followers),
    extra: { channelId: channel.id ?? "" },
  };
}

async function testConnection(conn: PlatformConnection) {
  const start = Date.now();
  try {
    await fetchProfile(conn);
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
      message: "Connected to YouTube",
      details: [
        { label: "Credentials present", ok: !!(conn.credentials.clientId && conn.credentials.clientSecret) },
        { label: "Access token present", ok: !!conn.credentials.accessToken },
        { label: "YouTube API reachable", ok: true },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "YouTube connection failed";
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
      message,
      details: [
        { label: "Credentials present", ok: !!(conn.credentials.clientId && conn.credentials.clientSecret) },
        { label: "Access token present", ok: !!conn.credentials.accessToken },
        { label: "YouTube API reachable", ok: false, info: message },
      ],
    };
  }
}

function buildMultipartBody(metadata: object, videoBuffer: Buffer, videoMime: string) {
  const boundary = `pulse-${Date.now().toString(36)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${videoMime}\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  return { body: Buffer.concat([head, videoBuffer, tail]), boundary };
}

async function publish(conn: PlatformConnection, post: Post, target: PostTarget, media: MediaAsset[]): Promise<PublishResult> {
  const asset = media[0];
  if (!asset || asset.kind !== "video") throw new PlatformError("youtube", "YouTube requires a video file to publish.");
  const title = (target.title ?? post.title ?? "").slice(0, spec.titleMaxLength ?? 100) || "Untitled";
  const description = effectiveCaption(post, target);
  const videoBuffer = fs.readFileSync(resolveMediaPath(asset.url));
  const metadata = {
    snippet: { title, description, categoryId: conn.settings.category || "22" },
    status: { privacyStatus: conn.settings.privacy === "friends" ? "unlisted" : conn.settings.privacy, selfDeclaredMadeForKids: conn.settings.madeForKids },
  };
  const { body, boundary } = buildMultipartBody(metadata, videoBuffer, asset.mimeType || "video/mp4");
  const res = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${conn.credentials.accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data.error) {
    throw new PlatformError("youtube", data.error?.message || `YouTube upload failed (${res.status})`, res.status);
  }
  return { externalId: data.id, externalUrl: `https://youtu.be/${data.id}` };
}

async function fetchMetrics(): Promise<[]> {
  // YouTube Analytics API requires a separate reporting scope/quota; left as a future
  // enhancement. Sandbox mode provides realistic demo data in the meantime.
  return [];
}

export const youtubeAdapter: PlatformAdapter = {
  buildAuthorizeUrl,
  exchangeCode,
  refreshToken,
  fetchProfile,
  testConnection,
  publish,
  fetchMetrics,
};
