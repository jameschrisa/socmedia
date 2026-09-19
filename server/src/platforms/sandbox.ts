import { nanoid } from "nanoid";
import type { MetricSnapshot, Platform, PlatformConnection } from "@socmedia/shared";
import type { PlatformAdapter } from "./types";

const isTestEnv = process.env.NODE_ENV === "test" || !!process.env.VITEST;

async function simulateLatency(min = 150, max = 400): Promise<void> {
  if (isTestEnv) return;
  const ms = min + Math.random() * (max - min);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Deterministic PRNG (mulberry32) seeded by a string, for reproducible sandbox metrics. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function next() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function fakeExternalUrl(platform: Platform, conn: PlatformConnection, id: string): string {
  const handle = conn.handle?.startsWith("@") ? conn.handle : `@${conn.handle || "sandbox"}`;
  switch (platform) {
    case "tiktok":
      return `https://www.tiktok.com/${handle}/video/${id}`;
    case "youtube":
      return `https://youtu.be/${id}`;
    case "linkedin":
      return `https://www.linkedin.com/feed/update/urn:li:share:${id}`;
    case "instagram":
      return `https://www.instagram.com/p/${id}/`;
  }
}

/** Wraps a real adapter so sandbox-mode connections get simulated, deterministic responses. */
export function sandboxWrap(real: PlatformAdapter, platform: Platform): PlatformAdapter {
  return {
    buildAuthorizeUrl: (conn, state) => real.buildAuthorizeUrl(conn, state),

    async exchangeCode(conn, code) {
      if (conn.mode !== "sandbox") return real.exchangeCode(conn, code);
      await simulateLatency();
      return {
        accessToken: `sb_access_${nanoid(10)}`,
        refreshToken: `sb_refresh_${nanoid(10)}`,
        tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
    },

    async refreshToken(conn) {
      if (conn.mode !== "sandbox") return real.refreshToken(conn);
      await simulateLatency();
      return {
        accessToken: `sb_access_${nanoid(10)}`,
        refreshToken: conn.credentials.refreshToken || `sb_refresh_${nanoid(10)}`,
        tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
    },

    async fetchProfile(conn) {
      if (conn.mode !== "sandbox") return real.fetchProfile(conn);
      await simulateLatency();
      const seed = conn.displayName || platform;
      return {
        displayName: conn.displayName || "Sandbox Account",
        handle: conn.handle || `@sandbox_${platform}`,
        avatarUrl: conn.avatarUrl || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}`,
        followers: conn.followers || 1000,
        extra: {},
      };
    },

    async testConnection(conn) {
      if (conn.mode !== "sandbox") return real.testConnection(conn);
      const start = Date.now();
      await simulateLatency();
      const hasCredentials = !!(conn.credentials.clientId && conn.credentials.clientSecret && conn.credentials.redirectUri);
      const hasToken = !!conn.credentials.accessToken;
      const tokenFresh = !conn.credentials.tokenExpiresAt || Date.parse(conn.credentials.tokenExpiresAt) > Date.now();
      const ok = hasCredentials && hasToken && tokenFresh;
      return {
        ok,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        message: ok ? "Sandbox connection healthy" : "Sandbox connection is missing credentials or a valid token",
        details: [
          { label: "Credentials present", ok: hasCredentials },
          { label: "Access token present", ok: hasToken },
          { label: "Token not expired", ok: tokenFresh },
          { label: "API reachable (simulated)", ok: true },
        ],
      };
    },

    async publish(conn, post, target, media) {
      if (conn.mode !== "sandbox") return real.publish(conn, post, target, media);
      await simulateLatency();
      const id = `sb_${nanoid(12)}`;
      return { externalId: id, externalUrl: fakeExternalUrl(platform, conn, id) };
    },

    async fetchMetrics(conn, days) {
      if (conn.mode !== "sandbox") return real.fetchMetrics(conn, days);
      const rand = seededRandom(conn.id);
      const base = 500 + Math.floor(rand() * 5000);
      const baseFollowers = conn.followers || 1000;
      const out: Partial<MetricSnapshot>[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        const impressions = Math.round(base * (0.7 + rand() * 0.6));
        const reach = Math.round(impressions * (0.6 + rand() * 0.3));
        const views = Math.round(impressions * (0.8 + rand() * 0.2));
        const likes = Math.round(impressions * (0.02 + rand() * 0.05));
        const comments = Math.round(likes * (0.05 + rand() * 0.1));
        const shares = Math.round(likes * (0.02 + rand() * 0.05));
        const saves = Math.round(likes * (0.02 + rand() * 0.04));
        const clicks = Math.round(impressions * (0.01 + rand() * 0.02));
        const engagementRate = impressions > 0 ? (likes + comments + shares + saves) / impressions : 0;
        out.push({
          date,
          followers: Math.max(0, baseFollowers + Math.round((i - days / 2) * -1 * (rand() * 3))),
          impressions,
          reach,
          likes,
          comments,
          shares,
          saves,
          clicks,
          views,
          engagementRate: Number(engagementRate.toFixed(4)),
        });
      }
      return out;
    },
  };
}
