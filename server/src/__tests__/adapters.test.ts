import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PlatformConnection } from "@socmedia/shared";
import { defaultCredentials, defaultSettings } from "../db/defaults";
import { getAdapter } from "../platforms";
import { instagramAdapter } from "../platforms/instagram";
import { linkedinAdapter } from "../platforms/linkedin";
import { tiktokAdapter } from "../platforms/tiktok";
import { youtubeAdapter } from "../platforms/youtube";
import { xAdapter } from "../platforms/x";

function makeConnection(platform: PlatformConnection["platform"], overrides: Partial<PlatformConnection> = {}): PlatformConnection {
  const now = new Date().toISOString();
  return {
    id: `conn_${platform}`,
    orgId: "org_1",
    platform,
    enabled: true,
    mode: "live",
    status: "disconnected",
    displayName: "",
    handle: "",
    avatarUrl: null,
    followers: 0,
    credentials: { ...defaultCredentials(platform), clientId: "the-client-id", redirectUri: "https://app.example.com/oauth/callback" },
    settings: defaultSettings(platform),
    lastTest: null,
    connectedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("platform adapters: buildAuthorizeUrl", () => {
  it("tiktok: uses client_key, comma-scopes, and the v2 authorize path", () => {
    const conn = makeConnection("tiktok");
    const url = new URL(tiktokAdapter.buildAuthorizeUrl(conn, "state123"));
    expect(url.hostname).toBe("www.tiktok.com");
    expect(url.pathname).toBe("/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("the-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/oauth/callback");
    expect(url.searchParams.get("state")).toBe("state123");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toContain(",");
    expect(url.searchParams.get("scope")).toContain("user.info.basic");
  });

  it("youtube: uses Google's OAuth endpoint with space-separated scopes and offline access", () => {
    const conn = makeConnection("youtube");
    const url = new URL(youtubeAdapter.buildAuthorizeUrl(conn, "state456"));
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("the-client-id");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain(" ");
    expect(url.searchParams.get("scope")).toContain("youtube.upload");
    expect(url.searchParams.get("state")).toBe("state456");
  });

  it("linkedin: uses linkedin.com/oauth/v2/authorization with space-separated scopes", () => {
    const conn = makeConnection("linkedin");
    const url = new URL(linkedinAdapter.buildAuthorizeUrl(conn, "state789"));
    expect(url.hostname).toBe("www.linkedin.com");
    expect(url.pathname).toBe("/oauth/v2/authorization");
    expect(url.searchParams.get("client_id")).toBe("the-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toContain("w_member_social");
    expect(url.searchParams.get("state")).toBe("state789");
  });

  it("instagram: uses the Facebook dialog with comma-separated scopes", () => {
    const conn = makeConnection("instagram");
    const url = new URL(instagramAdapter.buildAuthorizeUrl(conn, "stateabc"));
    expect(url.hostname).toBe("www.facebook.com");
    expect(url.pathname).toBe("/v21.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("the-client-id");
    expect(url.searchParams.get("scope")).toContain("instagram_basic");
    expect(url.searchParams.get("state")).toBe("stateabc");
  });

  it("x: uses x.com/i/oauth2/authorize with a PKCE S256 challenge derived from the persisted code_verifier", () => {
    const verifier = "test-code-verifier-1234567890-abcdefghij";
    const expectedChallenge = crypto.createHash("sha256").update(verifier).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const conn = makeConnection("x", { credentials: { ...defaultCredentials("x"), clientId: "the-client-id", redirectUri: "https://app.example.com/oauth/callback", extra: { codeVerifier: verifier } } });
    const url = new URL(xAdapter.buildAuthorizeUrl(conn, "statex1"));
    expect(url.hostname).toBe("x.com");
    expect(url.pathname).toBe("/i/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("the-client-id");
    expect(url.searchParams.get("state")).toBe("statex1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(expectedChallenge);
  });

  it("x: prepareAuthorization generates a fresh code_verifier for the connect route to persist", () => {
    const conn = makeConnection("x");
    const a = xAdapter.prepareAuthorization!(conn);
    const b = xAdapter.prepareAuthorization!(conn);
    expect(a.extra.codeVerifier).toBeTruthy();
    expect(a.extra.codeVerifier).not.toBe(b.extra.codeVerifier);
  });
});

describe("sandbox-wrapped adapters", () => {
  it("testConnection ok/failure paths depend on credentials + token presence", async () => {
    const adapter = getAdapter("tiktok");
    const bare = makeConnection("tiktok", { mode: "sandbox", credentials: { ...defaultCredentials("tiktok") } });
    const failing = await adapter.testConnection(bare);
    expect(failing.ok).toBe(false);
    expect(failing.details.length).toBeGreaterThanOrEqual(3);

    const ready = makeConnection("tiktok", {
      mode: "sandbox",
      credentials: {
        ...defaultCredentials("tiktok"),
        clientId: "id",
        clientSecret: "secret",
        redirectUri: "https://app.example.com/cb",
        accessToken: "token",
        tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    const passing = await adapter.testConnection(ready);
    expect(passing.ok).toBe(true);
  });

  it("publish returns platform-specific fake URLs", async () => {
    const post = { id: "p1", orgId: "org_1", title: "T", caption: "C", hashtags: [], mediaIds: [], targets: [], status: "draft", scheduledAt: null, timezone: "UTC", labels: [], notes: "", createdAt: "", updatedAt: "", publishedAt: null } as any;

    const tiktokConn = makeConnection("tiktok", { mode: "sandbox", handle: "@brand" });
    const tiktokResult = await getAdapter("tiktok").publish(tiktokConn, post, { platform: "tiktok", connectionId: tiktokConn.id, format: "portrait_9_16", mediaIds: [] }, []);
    expect(tiktokResult.externalUrl).toMatch(/^https:\/\/www\.tiktok\.com\/@brand\/video\//);

    const youtubeConn = makeConnection("youtube", { mode: "sandbox" });
    const youtubeResult = await getAdapter("youtube").publish(youtubeConn, post, { platform: "youtube", connectionId: youtubeConn.id, format: "landscape_16_9", mediaIds: [] }, []);
    expect(youtubeResult.externalUrl).toMatch(/^https:\/\/youtu\.be\//);

    const linkedinConn = makeConnection("linkedin", { mode: "sandbox" });
    const linkedinResult = await getAdapter("linkedin").publish(linkedinConn, post, { platform: "linkedin", connectionId: linkedinConn.id, format: "square", mediaIds: [] }, []);
    expect(linkedinResult.externalUrl).toMatch(/^https:\/\/www\.linkedin\.com\/feed\/update\/urn:li:share:/);

    const instagramConn = makeConnection("instagram", { mode: "sandbox" });
    const instagramResult = await getAdapter("instagram").publish(instagramConn, post, { platform: "instagram", connectionId: instagramConn.id, format: "square", mediaIds: [] }, []);
    expect(instagramResult.externalUrl).toMatch(/^https:\/\/www\.instagram\.com\/p\//);

    const xConn = makeConnection("x", { mode: "sandbox", handle: "@brand" });
    const xResult = await getAdapter("x").publish(xConn, post, { platform: "x", connectionId: xConn.id, format: "square", mediaIds: [] }, []);
    expect(xResult.externalUrl).toMatch(/^https:\/\/x\.com\/brand\/status\//);
  });

  it("x: rejects captions over 280 characters before making any network call", async () => {
    const post = { id: "p1", orgId: "org_1", title: "T", caption: "x".repeat(300), hashtags: [], mediaIds: [], targets: [], status: "draft", scheduledAt: null, timezone: "UTC", labels: [], notes: "", createdAt: "", updatedAt: "", publishedAt: null } as any;
    const conn = makeConnection("x", { mode: "live", handle: "@brand", credentials: { ...defaultCredentials("x"), accessToken: "token" } });
    await expect(xAdapter.publish(conn, post, { platform: "x", connectionId: conn.id, format: "square", mediaIds: [] }, [])).rejects.toThrow(/280 characters/);
  });

  it("fetchMetrics is deterministic for a given connection id", async () => {
    const conn = makeConnection("tiktok", { id: "fixed-conn-id", mode: "sandbox", followers: 5000 });
    const adapter = getAdapter("tiktok");
    const first = await adapter.fetchMetrics(conn, 5);
    const second = await adapter.fetchMetrics(conn, 5);
    expect(first).toEqual(second);
    expect(first).toHaveLength(5);
  });
});
