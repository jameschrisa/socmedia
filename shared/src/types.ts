import type { Platform, PostFormat } from "./platforms";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  brandColor: string;
  timezone: string;
  logoUrl?: string | null;
  createdAt: string;
}

export type ConnectionStatus = "disconnected" | "connected" | "error" | "expired";
export type ConnectionMode = "sandbox" | "live";

export interface ConnectionCredentials {
  clientId: string;
  clientSecret: string;      // masked when returned by the API
  redirectUri: string;
  accessToken?: string | null;   // masked when returned
  refreshToken?: string | null;  // masked when returned
  tokenExpiresAt?: string | null;
  scopes: string[];
  // platform-specific extras (e.g. instagram business account id, linkedin org urn)
  extra: Record<string, string>;
}

export interface ConnectionSettings {
  defaultFormat: PostFormat;
  privacy: "public" | "private" | "unlisted" | "friends";
  autoHashtags: boolean;
  firstCommentHashtags: boolean;
  allowComments: boolean;
  allowDuet: boolean;      // tiktok
  allowStitch: boolean;    // tiktok
  madeForKids: boolean;    // youtube
  category: string;        // youtube category id
  postAsOrganization: boolean; // linkedin
  shareToFeed: boolean;    // instagram reels
}

export interface ConnectionTestResult {
  ok: boolean;
  checkedAt: string;
  latencyMs: number;
  message: string;
  details: { label: string; ok: boolean; info?: string }[];
}

export interface PlatformConnection {
  id: string;
  orgId: string;
  platform: Platform;
  enabled: boolean;
  mode: ConnectionMode;
  status: ConnectionStatus;
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  followers: number;
  credentials: ConnectionCredentials;
  settings: ConnectionSettings;
  lastTest?: ConnectionTestResult | null;
  connectedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MediaAsset {
  id: string;
  orgId: string;
  kind: "image" | "video";
  filename: string;
  mimeType: string;
  size: number;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  url: string;
  thumbnailUrl?: string | null;
  tags: string[];
  sourceAssetId?: string | null; // when derived from an edit
  format?: PostFormat | null;    // when exported for a specific format
  createdAt: string;
}

export type PostStatus =
  | "draft"
  | "needs_approval"
  | "approved"
  | "scheduled"
  | "publishing"
  | "published"
  | "partially_published"
  | "failed";

export interface PostTarget {
  platform: Platform;
  connectionId: string;
  format: PostFormat;
  mediaIds: string[];           // per-platform media (may be format-specific exports)
  caption?: string | null;      // override
  title?: string | null;        // youtube
  hashtags?: string[] | null;   // override
}

export interface Post {
  id: string;
  orgId: string;
  title: string;
  caption: string;
  hashtags: string[];
  mediaIds: string[];
  targets: PostTarget[];
  status: PostStatus;
  scheduledAt?: string | null; // ISO UTC
  timezone: string;
  labels: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface PublishJob {
  id: string;
  orgId: string;
  postId: string;
  connectionId: string;
  platform: Platform;
  status: JobStatus;
  attempts: number;
  externalId?: string | null;
  externalUrl?: string | null;
  error?: string | null;
  log: { at: string; message: string }[];
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
}

export interface MetricSnapshot {
  id: string;
  orgId: string;
  connectionId: string;
  platform: Platform;
  postId?: string | null;
  date: string; // YYYY-MM-DD
  followers: number;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  views: number;
  engagementRate: number;
}

export interface AnalyticsSummary {
  range: { from: string; to: string };
  totals: Omit<MetricSnapshot, "id" | "orgId" | "connectionId" | "platform" | "postId" | "date">;
  byPlatform: Record<Platform, Omit<MetricSnapshot, "id" | "orgId" | "connectionId" | "platform" | "postId" | "date"> & { snapshots: number }>;
  series: { date: string; platform: Platform; impressions: number; engagement: number; followers: number }[];
  topPosts: { postId: string; title: string; platform: Platform; engagement: number; impressions: number; externalUrl?: string | null }[];
}

export type AiTone = "professional" | "casual" | "playful" | "inspirational" | "educational" | "bold";

export interface CaptionRequest {
  brief: string;
  platforms: Platform[];
  tone: AiTone;
  brandVoice?: string;
  includeHashtags?: boolean;
  includeCta?: boolean;
  language?: string;
  variants?: number; // 1..5
}

export interface CaptionVariant {
  platform: Platform;
  caption: string;
  hashtags: string[];
  title?: string;
  hook: string;
  charCount: number;
}

export interface CaptionResponse {
  variants: CaptionVariant[];
  model: string;
  mock: boolean;
}

export interface IdeaRequest {
  topic: string;
  platforms: Platform[];
  audience?: string;
  count?: number;
  brandVoice?: string;
}

export interface ContentIdea {
  title: string;
  hook: string;
  format: PostFormat;
  platform: Platform;
  outline: string[];
  whyItWorks: string;
}

export interface IdeaResponse {
  ideas: ContentIdea[];
  model: string;
  mock: boolean;
}

export interface ApiError {
  error: string;
  details?: unknown;
}

/** AI provider configuration (workspace-wide). Secrets are masked when returned by the API. */
export type AiProvider = "anthropic" | "moonshot" | "mock";

export interface AiProviderConfig {
  apiKey: string;   // masked in responses
  model: string;
  baseUrl?: string; // moonshot only
}

export interface AiSettings {
  provider: AiProvider;
  anthropic: AiProviderConfig;
  moonshot: AiProviderConfig;
  /** True when the anthropic key came from the ANTHROPIC_API_KEY env var rather than saved settings. */
  anthropicFromEnv: boolean;
  updatedAt?: string | null;
}

export interface AiProviderTestResult {
  ok: boolean;
  provider: AiProvider;
  model: string;
  latencyMs: number;
  message: string;
}

export const AI_MODEL_SUGGESTIONS: Record<Exclude<AiProvider, "mock">, { id: string; label: string }[]> = {
  anthropic: [
    { id: "claude-opus-5", label: "Claude Opus 5 (recommended)" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fast, low cost)" },
    { id: "claude-fable-5-1", label: "Claude Fable 5.1 (most capable)" },
  ],
  moonshot: [
    { id: "kimi-k3", label: "Kimi K3 (flagship)" },
    { id: "kimi-k2.6", label: "Kimi K2.6" },
    { id: "kimi-k2.7-code", label: "Kimi K2.7 Code" },
  ],
};
