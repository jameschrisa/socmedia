import { PLATFORM_SPECS, effectiveCaption } from "@socmedia/shared";
import type { ConnectionCredentials, MediaAsset, Post, PostTarget, PlatformConnection } from "@socmedia/shared";
import { toAbsoluteUrl } from "../services/media";
import type { PlatformAdapter, ProfileInfo, PublishResult } from "./types";
import { PlatformError } from "./types";

const spec = PLATFORM_SPECS.instagram;
const GRAPH = "https://graph.facebook.com/v21.0";

function buildAuthorizeUrl(conn: PlatformConnection, state: string): string {
  const url = new URL(spec.oauth.authorizeUrl);
  url.searchParams.set("client_id", conn.credentials.clientId);
  url.searchParams.set("redirect_uri", conn.credentials.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", (conn.credentials.scopes.length ? conn.credentials.scopes : spec.oauth.scopes).join(","));
  return url.toString();
}

async function exchangeCode(conn: PlatformConnection, code: string): Promise<Partial<ConnectionCredentials>> {
  const url = new URL(spec.oauth.tokenUrl);
  url.searchParams.set("client_id", conn.credentials.clientId);
  url.searchParams.set("client_secret", conn.credentials.clientSecret);
  url.searchParams.set("redirect_uri", conn.credentials.redirectUri);
  url.searchParams.set("code", code);
  const res = await fetch(url.toString());
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data.error) {
    throw new PlatformError("instagram", data.error?.message || `Instagram token exchange failed (${res.status})`, res.status);
  }
  return {
    accessToken: data.access_token,
    tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  };
}

async function refreshToken(conn: PlatformConnection): Promise<Partial<ConnectionCredentials>> {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", conn.credentials.clientId);
  url.searchParams.set("client_secret", conn.credentials.clientSecret);
  url.searchParams.set("fb_exchange_token", conn.credentials.accessToken || "");
  const res = await fetch(url.toString());
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data.error) {
    throw new PlatformError("instagram", data.error?.message || `Instagram token refresh failed (${res.status})`, res.status);
  }
  return {
    accessToken: data.access_token,
    tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : conn.credentials.tokenExpiresAt,
  };
}

async function findIgUserId(conn: PlatformConnection): Promise<{ igUserId: string; pageId: string }> {
  const res = await fetch(`${GRAPH}/me/accounts?fields=instagram_business_account,name&access_token=${conn.credentials.accessToken}`);
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data.error) {
    throw new PlatformError("instagram", data.error?.message || `Instagram page lookup failed (${res.status})`, res.status);
  }
  const page = (data.data ?? []).find((p: any) => p.instagram_business_account?.id);
  if (!page) throw new PlatformError("instagram", "No Facebook Page with a linked Instagram Business account was found.");
  return { igUserId: page.instagram_business_account.id, pageId: page.id };
}

async function fetchProfile(conn: PlatformConnection): Promise<ProfileInfo> {
  const { igUserId } = await findIgUserId(conn);
  const res = await fetch(`${GRAPH}/${igUserId}?fields=username,name,profile_picture_url,followers_count&access_token=${conn.credentials.accessToken}`);
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data.error) {
    throw new PlatformError("instagram", data.error?.message || `Instagram profile fetch failed (${res.status})`, res.status);
  }
  return {
    displayName: data.name || conn.displayName,
    handle: data.username ? `@${data.username}` : conn.handle,
    avatarUrl: data.profile_picture_url ?? conn.avatarUrl,
    followers: data.followers_count ?? conn.followers,
    extra: { igUserId },
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
      message: "Connected to Instagram",
      details: [
        { label: "Credentials present", ok: !!(conn.credentials.clientId && conn.credentials.clientSecret) },
        { label: "Access token present", ok: !!conn.credentials.accessToken },
        { label: "Instagram Graph API reachable", ok: true },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Instagram connection failed";
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
      message,
      details: [
        { label: "Credentials present", ok: !!(conn.credentials.clientId && conn.credentials.clientSecret) },
        { label: "Access token present", ok: !!conn.credentials.accessToken },
        { label: "Instagram Graph API reachable", ok: false, info: message },
      ],
    };
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForContainer(igUserId: string, containerId: string, accessToken: string) {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${GRAPH}/${containerId}?fields=status_code&access_token=${accessToken}`);
    const data = (await res.json().catch(() => ({}))) as any;
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") throw new PlatformError("instagram", "Instagram media container failed to process.");
    await sleep(1000);
  }
  throw new PlatformError("instagram", "Timed out waiting for Instagram media container to finish processing.");
}

async function publish(conn: PlatformConnection, post: Post, target: PostTarget, media: MediaAsset[]): Promise<PublishResult> {
  const asset = media[0];
  if (!asset) throw new PlatformError("instagram", "Instagram posts require at least one media file.");
  const { igUserId } = conn.credentials.extra.igUserId
    ? { igUserId: conn.credentials.extra.igUserId }
    : await findIgUserId(conn);
  const caption = effectiveCaption(post, target);
  const accessToken = conn.credentials.accessToken || "";

  const params: Record<string, string> = { caption, access_token: accessToken };
  if (asset.kind === "video") {
    params.media_type = "REELS";
    params.video_url = toAbsoluteUrl(asset.url);
  } else {
    params.image_url = toAbsoluteUrl(asset.url);
  }
  const createRes = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const createData = (await createRes.json().catch(() => ({}))) as any;
  if (!createRes.ok || createData.error) {
    throw new PlatformError("instagram", createData.error?.message || `Instagram media creation failed (${createRes.status})`, createRes.status);
  }
  const containerId = createData.id;
  if (asset.kind === "video") {
    await waitForContainer(igUserId, containerId, accessToken);
  }
  const publishRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: containerId, access_token: accessToken }),
  });
  const publishData = (await publishRes.json().catch(() => ({}))) as any;
  if (!publishRes.ok || publishData.error) {
    throw new PlatformError("instagram", publishData.error?.message || `Instagram publish failed (${publishRes.status})`, publishRes.status);
  }
  return { externalId: publishData.id, externalUrl: `https://www.instagram.com/p/${publishData.id}/` };
}

async function fetchMetrics(conn: PlatformConnection): Promise<[]> {
  const igUserId = conn.credentials.extra.igUserId;
  if (!igUserId) return [];
  try {
    await fetch(`${GRAPH}/${igUserId}/insights?metric=impressions,reach,follower_count&period=day&access_token=${conn.credentials.accessToken}`);
  } catch {
    // best-effort; structured mapping into MetricSnapshot left for a future iteration
  }
  return [];
}

export const instagramAdapter: PlatformAdapter = {
  buildAuthorizeUrl,
  exchangeCode,
  refreshToken,
  fetchProfile,
  testConnection,
  publish,
  fetchMetrics,
};
