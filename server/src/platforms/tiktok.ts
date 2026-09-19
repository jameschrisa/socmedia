import { PLATFORM_SPECS } from "@socmedia/shared";
import type { ConnectionCredentials, MediaAsset, Post, PostTarget, PlatformConnection } from "@socmedia/shared";
import { toAbsoluteUrl } from "../services/media";
import { effectiveCaption } from "@socmedia/shared";
import type { PlatformAdapter, ProfileInfo, PublishResult } from "./types";
import { PlatformError } from "./types";

const spec = PLATFORM_SPECS.tiktok;

function buildAuthorizeUrl(conn: PlatformConnection, state: string): string {
  const url = new URL(spec.oauth.authorizeUrl);
  url.searchParams.set("client_key", conn.credentials.clientId);
  url.searchParams.set("scope", (conn.credentials.scopes.length ? conn.credentials.scopes : spec.oauth.scopes).join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", conn.credentials.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCode(conn: PlatformConnection, code: string): Promise<Partial<ConnectionCredentials>> {
  const res = await fetch(spec.oauth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({
      client_key: conn.credentials.clientId,
      client_secret: conn.credentials.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: conn.credentials.redirectUri,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data.error) {
    throw new PlatformError("tiktok", data.error_description || data.error || `TikTok token exchange failed (${res.status})`, res.status);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
    scopes: typeof data.scope === "string" ? data.scope.split(",") : conn.credentials.scopes,
  };
}

async function refreshToken(conn: PlatformConnection): Promise<Partial<ConnectionCredentials>> {
  const res = await fetch(spec.oauth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: conn.credentials.clientId,
      client_secret: conn.credentials.clientSecret,
      grant_type: "refresh_token",
      refresh_token: conn.credentials.refreshToken || "",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data.error) {
    throw new PlatformError("tiktok", data.error_description || data.error || `TikTok token refresh failed (${res.status})`, res.status);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? conn.credentials.refreshToken,
    tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : conn.credentials.tokenExpiresAt,
  };
}

async function fetchProfile(conn: PlatformConnection): Promise<ProfileInfo> {
  const res = await fetch(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,follower_count",
    { headers: { Authorization: `Bearer ${conn.credentials.accessToken}` } }
  );
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || (data.error && data.error.code && data.error.code !== "ok")) {
    throw new PlatformError("tiktok", data.error?.message || `TikTok profile fetch failed (${res.status})`, res.status);
  }
  const user = data.data?.user ?? {};
  return {
    displayName: user.display_name || conn.displayName,
    handle: user.display_name ? `@${user.display_name}` : conn.handle,
    avatarUrl: user.avatar_url ?? conn.avatarUrl,
    followers: user.follower_count ?? conn.followers,
    extra: { openId: user.open_id ?? "", unionId: user.union_id ?? "" },
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
      message: "Connected to TikTok",
      details: [
        { label: "Credentials present", ok: !!(conn.credentials.clientId && conn.credentials.clientSecret) },
        { label: "Access token present", ok: !!conn.credentials.accessToken },
        { label: "TikTok API reachable", ok: true },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "TikTok connection failed";
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
      message,
      details: [
        { label: "Credentials present", ok: !!(conn.credentials.clientId && conn.credentials.clientSecret) },
        { label: "Access token present", ok: !!conn.credentials.accessToken },
        { label: "TikTok API reachable", ok: false, info: message },
      ],
    };
  }
}

async function publish(conn: PlatformConnection, post: Post, target: PostTarget, media: MediaAsset[]): Promise<PublishResult> {
  const primary = media[0];
  if (!primary) throw new PlatformError("tiktok", "TikTok posts require at least one media file.");
  const caption = effectiveCaption(post, target);
  const isVideo = primary.kind === "video";
  const endpoint = isVideo
    ? "https://open.tiktokapis.com/v2/post/publish/video/init/"
    : "https://open.tiktokapis.com/v2/post/publish/content/init/";
  const body = isVideo
    ? {
        post_info: { title: caption, privacy_level: "SELF_ONLY", disable_duet: false, disable_stitch: false, disable_comment: false },
        source_info: { source: "PULL_FROM_URL", video_url: toAbsoluteUrl(primary.url) },
      }
    : {
        post_info: { title: caption, description: caption },
        source_info: { source: "PULL_FROM_URL", photo_images: media.map((m) => toAbsoluteUrl(m.url)) },
        post_mode: "DIRECT_POST",
        media_type: "PHOTO",
      };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${conn.credentials.accessToken}` },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || (data.error && data.error.code !== "ok")) {
    throw new PlatformError("tiktok", data.error?.message || `TikTok publish failed (${res.status})`, res.status);
  }
  const publishId = data.data?.publish_id || data.data?.publishId;
  return {
    externalId: publishId,
    externalUrl: `https://www.tiktok.com/${conn.handle.startsWith("@") ? conn.handle : `@${conn.handle}`}`,
  };
}

async function fetchMetrics(): Promise<[]> {
  // TikTok's analytics endpoints require additional app review; live metrics are best-effort
  // and left for a future iteration. Sandbox mode covers demo/testing needs.
  return [];
}

export const tiktokAdapter: PlatformAdapter = {
  buildAuthorizeUrl,
  exchangeCode,
  refreshToken,
  fetchProfile,
  testConnection,
  publish,
  fetchMetrics,
};
