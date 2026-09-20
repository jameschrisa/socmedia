import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { addDays, format } from "date-fns";
import { CalendarClock, CalendarDays, CheckCircle2, Clapperboard, Plus, Sparkles, Users } from "lucide-react";
import { PLATFORMS, PLATFORM_SPECS } from "@socmedia/shared";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PlatformIcon, Skeleton, StatusBadge } from "@/components/ui";
import { compactNumber, formatDateTime } from "@/lib/utils";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useCurrentOrgId, useOrgs } from "@/hooks/useOrg";
import { useConnections } from "@/hooks/useConnections";
import { usePosts, usePostMutations } from "@/hooks/usePosts";
import { useAppStore } from "@/store/appStore";
import { StatTile } from "@/features/analytics/components/StatTile";
import { PlatformDot } from "@/features/analytics/components/PlatformDot";
import { engagementOf, rangeFor } from "@/features/analytics/analyticsUtils";

const linkButtonClass = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 bg-glass px-4 text-sm font-medium text-ink-700 transition-colors hover:border-ink-300 hover:bg-ink-50";

function greeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function OverviewPage() {
  const orgId = useCurrentOrgId();
  const qc = useQueryClient();
  const { currentOrg } = useOrgs();
  const openComposer = useAppStore((s) => s.openComposer);
  const setAiPanelOpen = useAppStore((s) => s.setAiPanelOpen);

  const now = useMemo(() => new Date(), []);
  const range = useMemo(() => rangeFor("30d", now), [now]);
  const upcomingWindow = useMemo(() => ({ from: now.toISOString(), to: addDays(now, 14).toISOString() }), [now]);

  const connectionsQuery = useConnections();

  const summaryQuery = useQuery({
    queryKey: qk.analytics(orgId, { ...range, kpi: "overview" }),
    queryFn: () => api.analytics.summary({ from: range.from, to: range.to }),
    enabled: !!orgId,
  });

  const publishedQuery = usePosts({ status: ["published", "partially_published"], includeUnscheduled: true });
  const publishedCount = useMemo(
    () => (publishedQuery.data ?? []).filter((p) => p.publishedAt && p.publishedAt.slice(0, 10) >= range.from && p.publishedAt.slice(0, 10) <= range.to).length,
    [publishedQuery.data, range],
  );

  const upcomingQuery = usePosts({ from: upcomingWindow.from, to: upcomingWindow.to });
  const upcoming = useMemo(
    () => (upcomingQuery.data ?? []).filter((p) => p.status === "scheduled").sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? "")).slice(0, 6),
    [upcomingQuery.data],
  );

  const approvalQuery = usePosts({ status: ["needs_approval"], includeUnscheduled: true });
  const { approve } = usePostMutations();

  const jobsQuery = useQuery({
    queryKey: qk.jobs(orgId, { limit: 8, scope: "overview" }),
    queryFn: () => api.jobs.list({ limit: 8 }),
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

  const totals = summaryQuery.data?.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{greeting(now)}, {currentOrg?.name ?? "there"}</h1>
          <p className="text-sm text-ink-500">{format(now, "EEEE, MMMM d")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => openComposer(null)}>New post</Button>
          <Button variant="outline" size="sm" icon={<Sparkles className="h-4 w-4 text-brand-500" />} onClick={() => setAiPanelOpen(true)}>Open AI Assistant</Button>
          <Link to="/calendar" className={linkButtonClass}><CalendarDays className="h-4 w-4" />Calendar</Link>
          <Link to="/studio" className={linkButtonClass}><Clapperboard className="h-4 w-4" />Studio</Link>
          <Link to="/connections" className={linkButtonClass}><Users className="h-4 w-4" />Social Profiles</Link>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-ink-700">Connected profiles</h2>
        {connectionsQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {PLATFORMS.map((p) => <Skeleton key={p} className="h-24" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {PLATFORMS.map((platform) => {
              const conn = (connectionsQuery.data ?? []).find((c) => c.platform === platform);
              return (
                <Link to="/connections" key={platform} className="card card-hover flex flex-col gap-3 p-4 min-h-[120px]">
                  <div className="flex items-center gap-3 min-w-0">
                    <PlatformIcon platform={platform} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink-900">{conn?.status === "connected" ? conn.handle || conn.displayName : "Not connected"}</p>
                      {conn?.status === "connected" && <p className="text-[11px] text-ink-500 tabular-nums">{compactNumber(conn.followers)} followers</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={conn?.status ?? "disconnected"} />
                    {conn && <Badge tone={conn.mode === "live" ? "brand" : "neutral"}>{conn.mode}</Badge>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-ink-700">Last 30 days</h2>
        {summaryQuery.isLoading ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Impressions" value={compactNumber(totals?.impressions ?? 0)} />
            <StatTile label="Engagement" value={compactNumber(totals ? engagementOf(totals) : 0)} />
            <StatTile label="Followers" value={compactNumber(totals?.followers ?? 0)} />
            <StatTile label="Published posts" value={compactNumber(publishedCount)} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming" subtitle="Next 6 scheduled posts" />
          <CardBody>
            {upcomingQuery.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
            ) : upcoming.length === 0 ? (
              <EmptyState
                icon={<CalendarClock className="h-8 w-8" />}
                title="Nothing scheduled"
                description="Plan your next post to fill the calendar."
                action={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => openComposer(null)}>New post</Button>}
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {upcoming.map((post) => (
                  <li key={post.id} className="flex items-center gap-3 py-2.5">
                    <div className="flex -space-x-1">
                      {[...new Set(post.targets.map((t) => t.platform))].map((p) => <PlatformDot key={p} platform={p} className="ring-2 ring-white" />)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-800">{post.title || "Untitled post"}</p>
                      <p className="text-xs text-ink-500">{formatDateTime(post.scheduledAt)}</p>
                    </div>
                    <StatusBadge status={post.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Needs approval" subtitle="Waiting on a reviewer" />
          <CardBody>
            {approvalQuery.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
            ) : (approvalQuery.data ?? []).length === 0 ? (
              <EmptyState icon={<CheckCircle2 className="h-8 w-8" />} title="All caught up" description="No posts are waiting for approval." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {(approvalQuery.data ?? []).map((post) => (
                  <li key={post.id} className="flex items-center gap-3 py-2.5">
                    <div className="flex -space-x-1">
                      {[...new Set(post.targets.map((t) => t.platform))].map((p) => <PlatformDot key={p} platform={p} className="ring-2 ring-white" />)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-800">{post.title || "Untitled post"}</p>
                      <p className="text-xs text-ink-500">{post.scheduledAt ? formatDateTime(post.scheduledAt) : "Not scheduled"}</p>
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      loading={approve.isPending && approve.variables === post.id}
                      onClick={() => approve.mutate(post.id, { onSuccess: () => toast.success("Post approved") })}
                    >
                      Approve
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent activity" subtitle="Latest publish jobs" />
        <CardBody>
          {jobsQuery.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
          ) : (jobsQuery.data ?? []).length === 0 ? (
            <EmptyState title="No activity yet" description="Published posts will show up here." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {(jobsQuery.data ?? []).slice(0, 8).map((job) => (
                <li key={job.id} className="flex items-center gap-3 py-2.5">
                  <PlatformIcon platform={job.platform} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink-800">{PLATFORM_SPECS[job.platform].name} publish {job.status === "succeeded" ? "succeeded" : job.status}</p>
                    <p className="text-xs text-ink-500">{formatDateTime(job.finishedAt ?? job.createdAt)}</p>
                  </div>
                  <StatusBadge status={job.status} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
