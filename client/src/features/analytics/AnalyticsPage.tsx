import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ExternalLink, Eye, Heart, MousePointerClick, RefreshCw, Users2 } from "lucide-react";
import { PLATFORMS, PLATFORM_SPECS, type MetricSnapshot, type Platform } from "@socmedia/shared";
import { Button, Card, CardBody, CardHeader, EmptyState, PlatformIcon, SegmentedTabs, Skeleton, StatusBadge } from "@/components/ui";
import { cn, compactNumber, percent, relativeTime } from "@/lib/utils";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useCurrentOrgId } from "@/hooks/useOrg";
import { usePosts } from "@/hooks/usePosts";
import { useAppStore } from "@/store/appStore";
import { StatTile } from "./components/StatTile";
import { PlatformDot } from "./components/PlatformDot";
import {
  RANGE_PRESETS, engagementOf, engagementRateByDate, kpiDelta, platformColor, rangeFor, seriesByDate, sumByDate,
  type RangePreset,
} from "./analyticsUtils";

type PlatformFilter = "all" | Platform;
type JobFilter = "all" | "failed" | "succeeded";

const jobFilterTabs = [
  { id: "all" as JobFilter, label: "All" },
  { id: "failed" as JobFilter, label: "Failed" },
  { id: "succeeded" as JobFilter, label: "Succeeded" },
];

function sumSnapshotsByDate(snapshots: MetricSnapshot[], key: "views" | "clicks"): { date: string; value: number }[] {
  const totals = new Map<string, number>();
  for (const s of snapshots) totals.set(s.date, (totals.get(s.date) ?? 0) + s[key]);
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

function sumValues(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function deltaFrom(values: number[]): { current: number; previous: number; deltaPct: number } {
  if (values.length === 0) return { current: 0, previous: 0, deltaPct: 0 };
  const mid = Math.ceil(values.length / 2);
  const first = values.slice(0, mid);
  const second = values.slice(mid);
  const previous = sumValues(first);
  const current = second.length ? sumValues(second) : previous;
  const deltaPct = previous === 0 ? (current === 0 ? 0 : 1) : (current - previous) / previous;
  return { current, previous, deltaPct };
}

export function AnalyticsPage() {
  const orgId = useCurrentOrgId();
  const qc = useQueryClient();
  const openComposer = useAppStore((s) => s.openComposer);

  const [rangePreset, setRangePreset] = useState<RangePreset>("30d");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [jobFilter, setJobFilter] = useState<JobFilter>("all");

  const range = useMemo(() => rangeFor(rangePreset), [rangePreset]);
  const platformParam = platform === "all" ? undefined : platform;

  const summaryQuery = useQuery({
    queryKey: qk.analytics(orgId, { ...range, platform: platformParam ?? "all" }),
    queryFn: () => api.analytics.summary({ from: range.from, to: range.to, platform: platformParam }),
    enabled: !!orgId,
  });

  const snapshotsQuery = useQuery({
    queryKey: qk.snapshots(orgId, { ...range, platform: platformParam ?? "all" }),
    queryFn: () => api.analytics.snapshots({ from: range.from, to: range.to, platform: platformParam }),
    enabled: !!orgId,
  });

  const jobsQuery = useQuery({
    queryKey: qk.jobs(orgId, { limit: 50 }),
    queryFn: () => api.jobs.list({ limit: 50 }),
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

  const postsQuery = usePosts({ includeUnscheduled: true });
  const postTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of postsQuery.data ?? []) map.set(p.id, p.title);
    return map;
  }, [postsQuery.data]);

  const syncMutation = useMutation({
    mutationFn: api.analytics.sync,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["analytics", orgId] });
      qc.invalidateQueries({ queryKey: ["snapshots", orgId] });
      toast.success(`Synced ${res.synced} snapshot${res.synced === 1 ? "" : "s"}`);
    },
    onError: (err: Error) => toast.error(err.message || "Sync failed"),
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.jobs.retry(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs", orgId] });
      toast.success("Job queued for retry");
    },
    onError: (err: Error) => toast.error(err.message || "Retry failed"),
  });

  const summary = summaryQuery.data;
  const series = summary?.series ?? [];
  const activePlatforms: Platform[] = platform === "all" ? [...PLATFORMS] : [platform];

  const impressionsSpark = sumByDate(series, "impressions");
  const engagementSpark = sumByDate(series, "engagement");
  const followersSpark = sumByDate(series, "followers");
  const engagementRateSpark = engagementRateByDate(series);
  const viewsSpark = sumSnapshotsByDate(snapshotsQuery.data ?? [], "views");
  const clicksSpark = sumSnapshotsByDate(snapshotsQuery.data ?? [], "clicks");

  const totals = summary?.totals;
  const totalsAllZero = !!totals && Object.values(totals).every((v) => !v);

  const kpis = totals
    ? [
        {
          label: "Followers",
          value: compactNumber(totals.followers),
          deltaPct: kpiDelta(series, "followers").deltaPct,
          data: followersSpark,
          color: "#7C5CFC",
          icon: <Users2 className="h-4 w-4 text-ink-300" />,
        },
        {
          label: "Impressions",
          value: compactNumber(totals.impressions),
          deltaPct: kpiDelta(series, "impressions").deltaPct,
          data: impressionsSpark,
          color: "#0EA5E9",
          icon: <Eye className="h-4 w-4 text-ink-300" />,
        },
        {
          label: "Engagement",
          value: compactNumber(engagementOf(totals)),
          deltaPct: kpiDelta(series, "engagement").deltaPct,
          data: engagementSpark,
          color: "#22C55E",
          icon: <Heart className="h-4 w-4 text-ink-300" />,
        },
        {
          label: "Engagement rate",
          value: percent(totals.engagementRate),
          deltaPct: deltaFrom(engagementRateSpark.map((p) => p.value)).deltaPct,
          data: engagementRateSpark,
          color: "#F59E0B",
        },
        {
          label: "Views",
          value: compactNumber(totals.views),
          deltaPct: viewsSpark.length > 1 ? deltaFrom(viewsSpark.map((p) => p.value)).deltaPct : null,
          data: viewsSpark,
          color: "#EC4899",
          icon: <Eye className="h-4 w-4 text-ink-300" />,
        },
        {
          label: "Clicks",
          value: compactNumber(totals.clicks),
          deltaPct: clicksSpark.length > 1 ? deltaFrom(clicksSpark.map((p) => p.value)).deltaPct : null,
          data: clicksSpark,
          color: "#6366F1",
          icon: <MousePointerClick className="h-4 w-4 text-ink-300" />,
        },
      ]
    : [];

  const impressionsPivot = seriesByDate(series, "impressions");
  const followersPivot = seriesByDate(series, "followers");
  const engagementByPlatform = summary
    ? PLATFORMS.map((p) => ({ platform: p, engagement: engagementOf(summary.byPlatform[p]) })).filter((row) => activePlatforms.includes(row.platform))
    : [];

  const filteredJobs = (jobsQuery.data ?? []).filter((j) => (jobFilter === "all" ? true : jobFilter === "failed" ? j.status === "failed" : j.status === "succeeded"));

  return (
    <div className="space-y-6" data-testid="analytics-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Analytics</h1>
          <p className="text-sm text-ink-500">Performance across every connected platform.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedTabs items={RANGE_PRESETS.map((p) => ({ id: p.id, label: p.label }))} value={rangePreset} onChange={setRangePreset} />
          <div className="flex items-center gap-1 rounded-lg bg-ink-100 p-1" role="group" aria-label="Platform filter">
            <button
              type="button"
              onClick={() => setPlatform("all")}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", platform === "all" ? "bg-ink-300 text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700")}
            >
              All
            </button>
            {PLATFORMS.map((p) => (
              <button key={p} type="button" onClick={() => setPlatform(p)} className={cn("rounded-md p-1 transition-shadow", platform === p ? "bg-ink-300 shadow-sm ring-1 ring-inset ring-ink-200" : "opacity-70 hover:opacity-100")} title={PLATFORM_SPECS[p].name}>
                <PlatformIcon platform={p} size={22} mono />
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" icon={<RefreshCw className={cn("h-4 w-4", syncMutation.isPending && "animate-spin")} />} loading={syncMutation.isPending} onClick={() => syncMutation.mutate()}>
            Sync now
          </Button>
        </div>
      </div>

      {summaryQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : summaryQuery.isError ? (
        <Card><CardBody><EmptyState title="Couldn't load analytics" description={(summaryQuery.error as Error)?.message} /></CardBody></Card>
      ) : totalsAllZero ? (
        <Card>
          <CardBody>
            <EmptyState
              title="No analytics data yet"
              description="Sync to load data from your connected platforms."
              action={<Button size="sm" icon={<RefreshCw className="h-4 w-4" />} loading={syncMutation.isPending} onClick={() => syncMutation.mutate()}>Sync to load data</Button>}
            />
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            {kpis.map((tile) => <StatTile key={tile.label} {...tile} />)}
          </div>

          <Card>
            <CardHeader title="Impressions over time" subtitle="Per platform, stacked" />
            <CardBody>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={impressionsPivot}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--chart-tick)" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--chart-tick)" }} axisLine={false} tickLine={false} tickFormatter={(v) => compactNumber(v)} />
                    <Tooltip contentStyle={{ borderRadius: 0, border: "1px solid var(--c-edge-strong)", background: "var(--c-glass-menu)", color: "var(--c-ink-900)", boxShadow: "var(--sh-pop)", fontSize: 12 }} itemStyle={{ color: "var(--c-ink-900)" }} labelStyle={{ color: "var(--c-ink-500)" }} formatter={(v) => compactNumber(Number(v))} />
                    {activePlatforms.map((p) => (
                      <Area key={p} type="monotone" dataKey={p} stackId="impressions" stroke={platformColor(p)} fill={platformColor(p)} fillOpacity={0.15} strokeWidth={1.75} name={PLATFORM_SPECS[p].name} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Engagement by platform" />
              <CardBody>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={engagementByPlatform} layout="vertical" margin={{ left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--chart-grid)" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "var(--chart-tick)" }} axisLine={false} tickLine={false} tickFormatter={(v) => compactNumber(v)} />
                      <YAxis type="category" dataKey="platform" tick={{ fontSize: 11, fill: "var(--c-ink-700)" }} axisLine={false} tickLine={false} tickFormatter={(p: Platform) => PLATFORM_SPECS[p].name} width={70} />
                      <Tooltip contentStyle={{ borderRadius: 0, border: "1px solid var(--c-edge-strong)", background: "var(--c-glass-menu)", color: "var(--c-ink-900)", boxShadow: "var(--sh-pop)", fontSize: 12 }} itemStyle={{ color: "var(--c-ink-900)" }} labelStyle={{ color: "var(--c-ink-500)" }} formatter={(v) => compactNumber(Number(v))} />
                      <Bar dataKey="engagement" radius={[0, 6, 6, 0]}>
                        {engagementByPlatform.map((row) => <Cell key={row.platform} fill={platformColor(row.platform)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Follower growth" />
              <CardBody>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={followersPivot}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--chart-tick)" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--chart-tick)" }} axisLine={false} tickLine={false} tickFormatter={(v) => compactNumber(v)} />
                      <Tooltip contentStyle={{ borderRadius: 0, border: "1px solid var(--c-edge-strong)", background: "var(--c-glass-menu)", color: "var(--c-ink-900)", boxShadow: "var(--sh-pop)", fontSize: 12 }} itemStyle={{ color: "var(--c-ink-900)" }} labelStyle={{ color: "var(--c-ink-500)" }} formatter={(v) => compactNumber(Number(v))} />
                      {activePlatforms.map((p) => (
                        <Line key={p} type="monotone" dataKey={p} stroke={platformColor(p)} strokeWidth={1.75} dot={false} name={PLATFORM_SPECS[p].name} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Top posts" subtitle="Ranked by engagement in the selected range" />
            <CardBody className="!p-0">
              {summary && summary.topPosts.length === 0 ? (
                <EmptyState title="No posts with metrics yet" className="py-8" />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-400">
                      <th className="px-5 py-2.5 font-medium">Post</th>
                      <th className="px-5 py-2.5 font-medium">Impressions</th>
                      <th className="px-5 py-2.5 font-medium">Engagement</th>
                      <th className="px-5 py-2.5 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary?.topPosts.map((post) => (
                      <tr key={post.postId} className="border-b border-ink-100 last:border-0">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <PlatformIcon platform={post.platform} size={28} />
                            <span className="font-medium text-ink-800">{post.title}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 tabular-nums text-ink-600">{compactNumber(post.impressions)}</td>
                        <td className="px-5 py-3 tabular-nums text-ink-600">{compactNumber(post.engagement)}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-2">
                            {post.externalUrl && (
                              <a href={post.externalUrl} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700" title="Open on platform" aria-label="Open on platform">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            )}
                            <Button size="xs" variant="outline" onClick={() => openComposer(post.postId)}>Open</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
        </>
      )}

      <Card>
        <CardHeader
          title="Publish log"
          subtitle="Live status of every publish attempt, refreshed every 30 seconds"
          action={<SegmentedTabs items={jobFilterTabs} value={jobFilter} onChange={setJobFilter} />}
        />
        <CardBody className="!p-0">
          {jobsQuery.isLoading ? (
            <div className="space-y-2 p-5"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
          ) : filteredJobs.length === 0 ? (
            <EmptyState title="No publish jobs" description="Jobs appear here once posts start publishing." className="py-8" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-400">
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Platform</th>
                  <th className="px-5 py-2.5 font-medium">Post</th>
                  <th className="px-5 py-2.5 font-medium">Attempts</th>
                  <th className="px-5 py-2.5 font-medium">Finished</th>
                  <th className="px-5 py-2.5 font-medium">Error</th>
                  <th className="px-5 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job) => (
                  <tr key={job.id} className="border-b border-ink-100 last:border-0">
                    <td className="px-5 py-3"><StatusBadge status={job.status} /></td>
                    <td className="px-5 py-3"><span className="inline-flex items-center gap-1.5"><PlatformDot platform={job.platform} />{PLATFORM_SPECS[job.platform].name}</span></td>
                    <td className="px-5 py-3 text-ink-600">{postTitleById.get(job.postId) ?? <span className="font-mono text-xs text-ink-400">{job.postId.slice(0, 8)}</span>}</td>
                    <td className="px-5 py-3 tabular-nums text-ink-600">{job.attempts}</td>
                    <td className="px-5 py-3 text-ink-500">{relativeTime(job.finishedAt)}</td>
                    <td className="px-5 py-3 max-w-[220px] truncate text-ink-500" title={job.error ?? undefined}>{job.error ?? "None"}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {job.externalUrl && (
                          <a href={job.externalUrl} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700" title="Open published post" aria-label="Open published post">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                        {job.status === "failed" && (
                          <Button size="xs" variant="outline" loading={retryMutation.isPending && retryMutation.variables === job.id} onClick={() => retryMutation.mutate(job.id)}>
                            Retry
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
