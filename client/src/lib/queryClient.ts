import { QueryClient } from "@tanstack/react-query";

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
};
