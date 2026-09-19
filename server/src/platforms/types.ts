import type {
  ConnectionCredentials,
  ConnectionTestResult,
  MediaAsset,
  MetricSnapshot,
  Platform,
  PlatformConnection,
  Post,
  PostTarget,
} from "@socmedia/shared";

export class PlatformError extends Error {
  platform: Platform;
  status?: number;
  constructor(platform: Platform, message: string, status?: number) {
    super(message);
    this.name = "PlatformError";
    this.platform = platform;
    this.status = status;
  }
}

export interface ProfileInfo {
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  followers: number;
  extra?: Record<string, string>;
}

export interface PublishResult {
  externalId: string;
  externalUrl: string;
}

export interface PlatformAdapter {
  buildAuthorizeUrl(conn: PlatformConnection, state: string): string;
  exchangeCode(conn: PlatformConnection, code: string): Promise<Partial<ConnectionCredentials>>;
  refreshToken(conn: PlatformConnection): Promise<Partial<ConnectionCredentials>>;
  fetchProfile(conn: PlatformConnection): Promise<ProfileInfo>;
  testConnection(conn: PlatformConnection): Promise<ConnectionTestResult>;
  publish(conn: PlatformConnection, post: Post, target: PostTarget, media: MediaAsset[]): Promise<PublishResult>;
  fetchMetrics(conn: PlatformConnection, days: number): Promise<Partial<MetricSnapshot>[]>;
}
