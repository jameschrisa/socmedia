import { nanoid } from "nanoid";
import { PLATFORMS, PLATFORM_SPECS } from "@socmedia/shared";
import type { ConnectionCredentials, ConnectionSettings, Platform, PlatformConnection } from "@socmedia/shared";

export function defaultCredentials(platform: Platform): ConnectionCredentials {
  return {
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    scopes: [...PLATFORM_SPECS[platform].oauth.scopes],
    extra: {},
  };
}

export function defaultSettings(platform: Platform): ConnectionSettings {
  return {
    defaultFormat: PLATFORM_SPECS[platform].defaultFormat,
    privacy: "public",
    autoHashtags: true,
    firstCommentHashtags: false,
    allowComments: true,
    allowDuet: true,
    allowStitch: true,
    madeForKids: false,
    category: "22",
    postAsOrganization: false,
    shareToFeed: true,
  };
}

/** Builds a fresh, disconnected sandbox connection object for a platform (not yet persisted). */
export function buildDefaultConnection(orgId: string, platform: Platform, now: string): PlatformConnection {
  return {
    id: nanoid(),
    orgId,
    platform,
    enabled: true,
    mode: "sandbox",
    status: "disconnected",
    displayName: "",
    handle: "",
    avatarUrl: null,
    followers: 0,
    credentials: defaultCredentials(platform),
    settings: defaultSettings(platform),
    lastTest: null,
    connectedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function allPlatforms(): Platform[] {
  return [...PLATFORMS];
}
