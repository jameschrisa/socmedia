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
  /** Optional nickname to tell accounts on the same platform apart ("Main", "Founder", "EU"). */
  label: string;
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

/** How a post fans out to several accounts: all at once, or one after another with spacing. */
export type PublishMode = "all" | "queue";

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
  publishMode: PublishMode;
  /** Minutes between consecutive publishes when publishMode is "queue". */
  queueSpacingMinutes: number;
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
  /** For deferred (queued) jobs: the earliest time the scheduler may run it. */
  runAt?: string | null;
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

/** Workspace-wide publishing defaults. */
export interface PublishingSettings {
  defaultPublishMode: PublishMode;
  queueSpacingMinutes: number;
  /** Warn (validation) when the same caption goes to several accounts on one platform at once. */
  warnOnDuplicateCaptions: boolean;
}

/* ---------- Users & authentication ---------- */
export type UserRole = "owner" | "admin" | "editor" | "viewer";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** Organizations this user may access; `"*"` means every organization (owners/admins). */
  orgIds: string[] | "*";
  active: boolean;
  /** Set when the user must change a temporary password on next login. */
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
}

export interface AuthState {
  authenticated: boolean;
  /** True when no user exists yet: the login page offers to create the first owner. */
  needsSetup: boolean;
  user?: User | null;
  /** Sign-in methods on offer; present on /auth/status. */
  providers?: AuthProviders;
  /** Domains that may self-serve sign in (shown as a hint on the sign-in page). */
  allowedDomains?: string[];
}

/** Permissions derived from a role. Servers enforce these; clients use them to hide controls. */
export const ROLE_CAPABILITIES: Record<UserRole, { manageUsers: boolean; manageOrgs: boolean; manageSettings: boolean; write: boolean }> = {
  owner: { manageUsers: true, manageOrgs: true, manageSettings: true, write: true },
  admin: { manageUsers: true, manageOrgs: true, manageSettings: true, write: true },
  editor: { manageUsers: false, manageOrgs: false, manageSettings: false, write: true },
  viewer: { manageUsers: false, manageOrgs: false, manageSettings: false, write: false },
};

/* ---------- Video ---------- */
/** Longest video (upload or clip) the platform accepts, in seconds. */
export const VIDEO_MAX_SECONDS = 300;

export interface ClipRequest {
  start: number;          // seconds
  end: number;            // seconds, > start, end - start <= VIDEO_MAX_SECONDS
  format?: PostFormat | null; // crop/scale to a platform format
  mode: "new" | "replace";
  muted?: boolean;
}

/* ---------- Activity log / console ---------- */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSource = "http" | "auth" | "scheduler" | "publisher" | "media" | "agent" | "quick" | "system";

export interface LogEntry {
  id: string;
  at: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  orgId?: string | null;
  userId?: string | null;
  data?: Record<string, unknown> | null;
}

export interface LogFileInfo {
  name: string;       // e.g. app-2026-09-19.log
  size: number;       // bytes
  modifiedAt: string;
}

/* ---------- Agent console ---------- */
/** One tool call the agent made while handling a console command. */
export interface AgentAction {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

export interface AgentCommandResult {
  id: string;
  input: string;
  reply: string;
  actions: AgentAction[];
  model: string;
  mock: boolean;
  at: string;
}

/* ---------- Quick post from a phone ---------- */
/** A long-lived link a person can open on their phone to post a photo with a caption or voice memo. */
export interface QuickPostToken {
  id: string;
  orgId: string;
  userId: string;
  label: string;
  /** The full secret; only returned once, when the token is created. */
  token?: string;
  tokenPreview: string;          // last 4 characters
  connectionIds: string[];       // accounts to publish to; empty means every enabled account
  publishMode: PublishMode;
  active: boolean;
  usesCount: number;
  createdAt: string;
  lastUsedAt?: string | null;
}

/** What the phone page shows before posting (no session needed, only the token). */
export interface QuickPostPublicInfo {
  label: string;
  orgName: string;
  orgLogoUrl: string | null;
  brandColor: string;
  targets: { connectionId: string; platform: Platform; label: string | null; handle: string }[];
  /** True when an AI provider is configured, so a memo transcript can be turned into a caption. */
  aiAvailable: boolean;
}

export interface QuickPostLink {
  connectionId: string;
  platform: Platform;
  label: string | null;
  status: JobStatus;
  url: string | null;
  error: string | null;
}

export interface QuickPostResult {
  post: Post;
  media: MediaAsset;
  status: PostStatus | "needs_caption";
  caption: string;
  /** Where the caption came from: typed, the memo transcript, AI-written from the transcript, or nothing yet. */
  captionSource: "caption" | "transcript" | "ai" | "none";
  links: QuickPostLink[];
}

/* ---------- Sign-in methods, access policy and access requests ---------- */
/** Which sign-in methods the server currently offers (drives the sign-in page). */
export interface AuthProviders {
  password: boolean;
  /** Email sign-in links; true when a mail provider is configured, or in development where links go to the console. */
  magicLink: boolean;
  google: boolean;
}

/** A domain whose members may sign themselves in (magic link or Google) and how they are provisioned. */
export interface AllowedDomain {
  domain: string;            // lowercase, no @
  role: UserRole;            // role given to auto-provisioned users (never owner)
  orgSlugs: string[] | "*";  // organizations they get access to
}

export interface AccessPolicy {
  domains: AllowedDomain[];
  /** When true, users an admin already invited can use magic link / Google even if their domain is not listed. */
  allowInvitedUsersAnyDomain: boolean;
}

export type AccessRequestStatus = "pending" | "approved" | "declined";

export interface AccessRequest {
  id: string;
  email: string;
  name: string;
  organization?: string | null;
  message?: string | null;
  status: AccessRequestStatus;
  createdAt: string;
  decidedAt?: string | null;
  decidedBy?: string | null;
}

export interface MagicLinkRequestResult {
  ok: true;
  /** "email" when a message was sent; "log" when the link was written to the activity log (development only). */
  delivered: "email" | "log";
  /** Present only when delivered === "log" outside production, so developers can click it. */
  link?: string;
}
