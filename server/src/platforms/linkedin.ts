import fs from "node:fs";
import { PLATFORM_SPECS, effectiveCaption } from "@socmedia/shared";
import type { ConnectionCredentials, MediaAsset, Post, PostTarget, PlatformConnection } from "@socmedia/shared";
import { resolveMediaPath } from "../services/media";
import type { PlatformAdapter, ProfileInfo, PublishResult } from "./types";
import { PlatformError } from "./types";

const spec = PLATFORM_SPECS.linkedin;
const LI_VERSION = "202409";

function buildAuthorizeUrl(conn: PlatformConnection, state: string): string {
  const url = new URL(spec.oauth.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", conn.credentials.clientId);
  url.searchParams.set("redirect_uri", conn.credentials.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", (conn.credentials.scopes.length ? conn.credentials.scopes : spec.oauth.scopes).join(" "));
  return url.toString();
}

async function exchangeCode(conn: PlatformConnection, code: string): Promise<Partial<ConnectionCredentials>> {
  const res = await fetch(spec.oauth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: conn.credentials.redirectUri,
      client_id: conn.credentials.clientId,
      client_secret: conn.credentials.clientSecret,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data.error) {
    throw new PlatformError("linkedin", data.error_description || data.error || `LinkedIn token exchange failed (${res.status})`, res.status);
  }
  return {
    accessToken: data.access_token,
    tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  };
}

async function refreshToken(conn: PlatformConnection): Promise<Partial<ConnectionCredentials>> {
  const res = await fetch(spec.oauth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.credentials.refreshToken || "",
      client_id: conn.credentials.clientId,
      client_secret: conn.credentials.clientSecret,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data.error) {
    throw new PlatformError("linkedin", data.error_description || data.error || `LinkedIn token refresh failed (${res.status})`, res.status);
  }
  return {
    accessToken: data.access_token,
    tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : conn.credentials.tokenExpiresAt,
  };
}

async function fetchProfile(conn: PlatformConnection): Promise<ProfileInfo> {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${conn.credentials.accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new PlatformError("linkedin", data.message || `LinkedIn profile fetch failed (${res.status})`, res.status);
  }
  return {
    displayName: data.name || conn.displayName,
    handle: data.email ? data.email.split("@")[0] : conn.handle,
    avatarUrl: data.picture ?? conn.avatarUrl,
    followers: conn.followers,
    extra: { sub: data.sub ?? "" },
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
      message: "Connected to LinkedIn",
      details: [
        { label: "Credentials present", ok: !!(conn.credentials.clientId && conn.credentials.clientSecret) },
        { label: "Access token present", ok: !!conn.credentials.accessToken },
        { label: "LinkedIn API reachable", ok: true },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "LinkedIn connection failed";
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
      message,
      details: [
        { label: "Credentials present", ok: !!(conn.credentials.clientId && conn.credentials.clientSecret) },
        { label: "Access token present", ok: !!conn.credentials.accessToken },
        { label: "LinkedIn API reachable", ok: false, info: message },
      ],
    };
  }
}

function authorUrn(conn: PlatformConnection): string {
  if (conn.settings.postAsOrganization && conn.credentials.extra.organizationId) {
    return `urn:li:organization:${conn.credentials.extra.organizationId}`;
  }
  return `urn:li:person:${conn.credentials.extra.sub || conn.credentials.extra.personId || ""}`;
}

async function uploadImage(conn: PlatformConnection, asset: MediaAsset): Promise<string> {
  const initRes = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${conn.credentials.accessToken}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": LI_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn(conn) } }),
  });
  const initData = (await initRes.json().catch(() => ({}))) as any;
  if (!initRes.ok) {
    throw new PlatformError("linkedin", initData.message || `LinkedIn image upload init failed (${initRes.status})`, initRes.status);
  }
  const uploadUrl = initData.value?.uploadUrl;
  const image = initData.value?.image;
  const buffer = fs.readFileSync(resolveMediaPath(asset.url));
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${conn.credentials.accessToken}` },
    body: buffer,
  });
  if (!putRes.ok) throw new PlatformError("linkedin", `LinkedIn image upload failed (${putRes.status})`, putRes.status);
  return image;
}

async function publish(conn: PlatformConnection, post: Post, target: PostTarget, media: MediaAsset[]): Promise<PublishResult> {
  const caption = effectiveCaption(post, target);
  const images: string[] = [];
  for (const asset of media) {
    if (asset.kind === "image") images.push(await uploadImage(conn, asset));
  }
  const body: any = {
    author: authorUrn(conn),
    commentary: caption,
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (images.length === 1) {
    body.content = { media: { id: images[0] } };
  } else if (images.length > 1) {
    body.content = { multiImage: { images: images.map((id) => ({ id })) } };
  }
  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${conn.credentials.accessToken}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": LI_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as any);
    throw new PlatformError("linkedin", (data as any).message || `LinkedIn publish failed (${res.status})`, res.status);
  }
  const postId = res.headers.get("x-restli-id") || res.headers.get("x-linkedin-id") || "";
  return { externalId: postId, externalUrl: `https://www.linkedin.com/feed/update/${postId}` };
}

async function fetchMetrics(): Promise<[]> {
  // LinkedIn's organizational analytics require the Community Management API's social actions
  // endpoints, which need per-post URNs; left for a future iteration. Sandbox covers demos/tests.
  return [];
}

export const linkedinAdapter: PlatformAdapter = {
  buildAuthorizeUrl,
  exchangeCode,
  refreshToken,
  fetchProfile,
  testConnection,
  publish,
  fetchMetrics,
};
