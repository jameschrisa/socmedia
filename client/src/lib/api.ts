import type {
  AnalyticsSummary, CaptionRequest, CaptionResponse, ConnectionTestResult, IdeaRequest, IdeaResponse,
  MediaAsset, MetricSnapshot, Organization, Platform, PlatformConnection, Post, PublishJob, ValidationIssue,
  ConnectionUpdateInput, PostInput, PostUpdateInput, OrganizationInput, ImproveRequestInput,
  AiSettings, AiSettingsUpdateInput, AiProviderTestResult,
} from "@socmedia/shared";
import { useAppStore } from "@/store/appStore";

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const BASE = "/api";

function orgHeaders(): Record<string, string> {
  const orgId = useAppStore.getState().currentOrgId;
  return orgId ? { "X-Org-Id": orgId } : {};
}

export async function request<T>(path: string, init: RequestInit = {}, opts: { org?: boolean } = { org: true }): Promise<T> {
  const headers: Record<string, string> = { ...(opts.org === false ? {} : orgHeaders()), ...(init.headers as Record<string, string> | undefined) };
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body && !isForm && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const message = (data && typeof data === "object" && "error" in data && typeof (data as any).error === "string") ? (data as any).error : res.statusText || "Request failed";
    throw new ApiError(res.status, message, data && typeof data === "object" ? (data as any).details ?? (data as any).issues : undefined);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  health: () => request<{ ok: boolean; version: string; time: string; ai: { configured: boolean; provider: "anthropic" | "moonshot" | "mock"; model: string } }>("/health", {}, { org: false }),

  settings: {
    getAi: () => request<AiSettings>("/settings/ai", {}, { org: false }),
    updateAi: (input: AiSettingsUpdateInput) => request<AiSettings>("/settings/ai", { method: "PUT", body: json(input) }, { org: false }),
    testAi: (provider: "anthropic" | "moonshot") => request<AiProviderTestResult>("/settings/ai/test", { method: "POST", body: json({ provider }) }, { org: false }),
    aiModels: (provider: "anthropic" | "moonshot") => request<{ provider: string; models: string[] }>(`/settings/ai/models?provider=${provider}`, {}, { org: false }),
  },

  orgs: {
    list: () => request<Organization[]>("/orgs", {}, { org: false }),
    get: (id: string) => request<Organization>(`/orgs/${id}`, {}, { org: false }),
    create: (input: OrganizationInput) => request<Organization>("/orgs", { method: "POST", body: json(input) }, { org: false }),
    update: (id: string, input: Partial<OrganizationInput>) => request<Organization>(`/orgs/${id}`, { method: "PATCH", body: json(input) }, { org: false }),
    remove: (id: string) => request<void>(`/orgs/${id}`, { method: "DELETE" }, { org: false }),
    uploadLogo: (id: string, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return request<Organization>(`/orgs/${id}/logo`, { method: "POST", body: fd }, { org: false });
    },
    removeLogo: (id: string) => request<Organization>(`/orgs/${id}/logo`, { method: "DELETE" }, { org: false }),
  },

  connections: {
    list: () => request<PlatformConnection[]>("/connections"),
    get: (id: string) => request<PlatformConnection>(`/connections/${id}`),
    update: (id: string, input: ConnectionUpdateInput) => request<PlatformConnection>(`/connections/${id}`, { method: "PATCH", body: json(input) }),
    test: (id: string) => request<ConnectionTestResult>(`/connections/${id}/test`, { method: "POST" }),
    connect: (id: string) => request<{ authorizeUrl: string; state: string; sandbox?: boolean; connection?: PlatformConnection }>(`/connections/${id}/connect`, { method: "POST" }),
    disconnect: (id: string) => request<PlatformConnection>(`/connections/${id}/disconnect`, { method: "POST" }),
    refresh: (id: string) => request<PlatformConnection>(`/connections/${id}/refresh`, { method: "POST" }),
  },

  media: {
    list: () => request<MediaAsset[]>("/media"),
    upload: (file: File, extra: { tags?: string[]; sourceAssetId?: string; format?: string } = {}) => {
      const fd = new FormData();
      fd.append("file", file);
      if (extra.tags?.length) fd.append("tags", extra.tags.join(","));
      if (extra.sourceAssetId) fd.append("sourceAssetId", extra.sourceAssetId);
      if (extra.format) fd.append("format", extra.format);
      return request<MediaAsset>("/media", { method: "POST", body: fd });
    },
    exportDataUrl: (input: { dataUrl: string; filename: string; sourceAssetId?: string; format?: string; tags?: string[] }) =>
      request<MediaAsset>("/media/export", { method: "POST", body: json(input) }),
    update: (id: string, input: { tags?: string[] }) => request<MediaAsset>(`/media/${id}`, { method: "PATCH", body: json(input) }),
    remove: (id: string) => request<void>(`/media/${id}`, { method: "DELETE" }),
  },

  posts: {
    list: (params: { from?: string; to?: string; status?: string[]; platform?: Platform; includeUnscheduled?: boolean } = {}) => {
      const q = new URLSearchParams();
      if (params.from) q.set("from", params.from);
      if (params.to) q.set("to", params.to);
      if (params.status?.length) q.set("status", params.status.join(","));
      if (params.platform) q.set("platform", params.platform);
      if (params.includeUnscheduled) q.set("includeUnscheduled", "1");
      const qs = q.toString();
      return request<Post[]>(`/posts${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) => request<Post>(`/posts/${id}`),
    create: (input: PostInput) => request<Post>("/posts", { method: "POST", body: json(input) }),
    update: (id: string, input: PostUpdateInput) => request<Post>(`/posts/${id}`, { method: "PATCH", body: json(input) }),
    remove: (id: string) => request<void>(`/posts/${id}`, { method: "DELETE" }),
    validate: (id: string) => request<{ issues: ValidationIssue[] }>(`/posts/${id}/validate`, { method: "POST" }),
    schedule: (id: string, scheduledAt: string) => request<Post>(`/posts/${id}/schedule`, { method: "POST", body: json({ scheduledAt }) }),
    publish: (id: string) => request<{ post: Post; jobs: PublishJob[] }>(`/posts/${id}/publish`, { method: "POST" }),
    duplicate: (id: string) => request<Post>(`/posts/${id}/duplicate`, { method: "POST" }),
    approve: (id: string) => request<Post>(`/posts/${id}/approve`, { method: "POST" }),
  },

  jobs: {
    list: (params: { postId?: string; status?: string; limit?: number } = {}) => {
      const q = new URLSearchParams();
      if (params.postId) q.set("postId", params.postId);
      if (params.status) q.set("status", params.status);
      if (params.limit) q.set("limit", String(params.limit));
      const qs = q.toString();
      return request<PublishJob[]>(`/jobs${qs ? `?${qs}` : ""}`);
    },
    retry: (id: string) => request<PublishJob>(`/jobs/${id}/retry`, { method: "POST" }),
  },

  analytics: {
    summary: (params: { from?: string; to?: string; platform?: Platform } = {}) => {
      const q = new URLSearchParams();
      if (params.from) q.set("from", params.from);
      if (params.to) q.set("to", params.to);
      if (params.platform) q.set("platform", params.platform);
      const qs = q.toString();
      return request<AnalyticsSummary>(`/analytics/summary${qs ? `?${qs}` : ""}`);
    },
    sync: () => request<{ synced: number }>("/analytics/sync", { method: "POST" }),
    snapshots: (params: { platform?: Platform; from?: string; to?: string } = {}) => {
      const q = new URLSearchParams();
      if (params.platform) q.set("platform", params.platform);
      if (params.from) q.set("from", params.from);
      if (params.to) q.set("to", params.to);
      const qs = q.toString();
      return request<MetricSnapshot[]>(`/analytics/snapshots${qs ? `?${qs}` : ""}`);
    },
  },

  ai: {
    captions: (input: CaptionRequest) => request<CaptionResponse>("/ai/captions", { method: "POST", body: json(input) }),
    ideas: (input: IdeaRequest) => request<IdeaResponse>("/ai/ideas", { method: "POST", body: json(input) }),
    improve: (input: ImproveRequestInput) => request<{ caption: string; hashtags: string[]; model: string; mock: boolean }>("/ai/improve", { method: "POST", body: json(input) }),
    hashtags: (input: { caption: string; platform: Platform; count?: number }) => request<{ hashtags: string[]; model: string; mock: boolean }>("/ai/hashtags", { method: "POST", body: json(input) }),
    bestTimes: (platform: Platform) => request<{ slots: { weekday: number; hour: number; score: number }[] }>("/ai/best-times", { method: "POST", body: json({ platform }) }),
  },
};

export type Api = typeof api;
