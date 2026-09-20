import { QueryClient } from "@tanstack/react-query";
import type { AccessRequestStatus } from "@socmedia/shared";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
  },
});

/** Query keys, all scoped by org where relevant. */
export const qk = {
  health: ["health"] as const,
  aiSettings: ["settings", "ai"] as const,
  publishing: ["settings", "publishing"] as const,
  auth: ["auth", "me"] as const,
  users: ["users"] as const,
  orgs: ["orgs"] as const,
  connections: (orgId: string | null) => ["connections", orgId] as const,
  media: (orgId: string | null) => ["media", orgId] as const,
  posts: (orgId: string | null, range?: { from?: string; to?: string }) => ["posts", orgId, range ?? {}] as const,
  post: (orgId: string | null, id: string) => ["post", orgId, id] as const,
  jobs: (orgId: string | null, params?: Record<string, unknown>) => ["jobs", orgId, params ?? {}] as const,
  analytics: (orgId: string | null, params?: Record<string, unknown>) => ["analytics", orgId, params ?? {}] as const,
  snapshots: (orgId: string | null, params?: Record<string, unknown>) => ["snapshots", orgId, params ?? {}] as const,
  logs: (params?: Record<string, unknown>) => ["logs", params ?? {}] as const,
  logFiles: ["logs", "files"] as const,
  logFile: (name: string, tail?: number) => ["logs", "file", name, tail ?? null] as const,
  quickTokens: (orgId: string | null) => ["quick", "tokens", orgId] as const,
  quickInfo: (token: string) => ["quick", "info", token] as const,
  accessPolicy: ["settings", "accessPolicy"] as const,
  mailStatus: ["settings", "mail"] as const,
  accessRequests: (status: AccessRequestStatus) => ["accessRequests", status] as const,
  terminalStatus: ["terminal", "status"] as const,
  docsSearch: (params: { platform?: string; q: string }) => ["docs", "platforms", params] as const,
  inboundStatus: ["inbound", "status"] as const,
  inboundChannels: ["inbound", "channels"] as const,
  inboundBindings: ["inbound", "bindings"] as const,
  inboundMessages: (params?: Record<string, unknown>) => ["inbound", "messages", params ?? {}] as const,
  inboundMessage: (id: string) => ["inbound", "message", id] as const,
  inboundTranscription: ["inbound", "transcription"] as const,
};
