import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Camera, CheckCircle2, Circle, MessageSquare, Smartphone } from "lucide-react";
import { PLATFORM_SPECS, type Platform, type Post } from "@socmedia/shared";
import { Button, Card, CardBody, CardHeader, EmptyState, PlatformIcon, Skeleton, StatusBadge, Textarea } from "@/components/ui";
import { usePosts, usePostMutations } from "@/hooks/usePosts";
import { useMedia } from "@/hooks/useMedia";
import { useInboundMessages, useInboundStatus } from "@/hooks/useInbound";
import { useQuickTokens } from "@/hooks/useQuickPost";
import { useAppStore } from "@/store/appStore";
import { relativeTime } from "@/lib/utils";
import { maskSenderId } from "./inbound/inboundUtils";
import { SourceBadge } from "./SourceBadge";
import { REMOTE_SOURCE_LABEL, isFromToday, isWithinLastDays, needsCaption, remoteSourceOf, type RemoteSource, type RemoteTab } from "./remoteUtils";
import { StatTile } from "@/features/analytics/components/StatTile";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

/** One "needs a caption" draft: thumbnail, source, an inline caption editor and the actions to clear it. */
function NeedsCaptionRow({ post, thumbnailUrl, onOpenComposer }: { post: Post; thumbnailUrl: string | null; onOpenComposer: (id: string) => void }) {
  const { update, publish } = usePostMutations();
  const [caption, setCaption] = useState(post.caption);
  const source = remoteSourceOf(post) ?? "phone";
  const dirty = caption !== post.caption;
  const savingThis = update.isPending && update.variables?.id === post.id;
  const publishingThis = publish.isPending && publish.variables === post.id;

  const saveCaption = () => {
    update.mutate(
      { id: post.id, input: { caption } },
      { onSuccess: () => toast.success("Caption saved"), onError: (e) => toast.error(errorMessage(e)) },
    );
  };

  const publishNow = async () => {
    try {
      await update.mutateAsync({ id: post.id, input: { caption } });
      await publish.mutateAsync(post.id);
      toast.success("Post published");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <li className="flex flex-col gap-3 border-b border-ink-100 py-3 last:border-0 sm:flex-row sm:items-start" data-testid="needs-caption-row">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden bg-ink-100 text-ink-300">
        {thumbnailUrl ? <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <Camera className="h-5 w-5" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
          <SourceBadge source={source} />
          <span>Received {relativeTime(post.createdAt)}</span>
        </div>
        <Textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Write a caption…"
          rows={2}
          aria-label="Caption"
        />
        <p className="text-xs text-ink-400">Tip: end with a few hashtags, like #newpost #behindthescenes.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="remote-tap" disabled={!dirty} loading={savingThis} onClick={saveCaption}>Save caption</Button>
          <Button size="sm" className="remote-tap" disabled={!caption.trim()} loading={publishingThis} onClick={publishNow}>Publish now</Button>
          <Button size="sm" variant="ghost" className="remote-tap" onClick={() => onOpenComposer(post.id)}>Open in composer</Button>
        </div>
      </div>
    </li>
  );
}

interface ActivityEntry {
  id: string;
  at: string;
  source: RemoteSource;
  label: string;
  status: string;
  links: { platform: Platform; url: string | null }[];
}

interface SetupRow {
  done: boolean;
  label: string;
  tab: RemoteTab;
  cta: string;
}

function SetupChecklist({ rows, onNavigate }: { rows: SetupRow[]; onNavigate: (tab: RemoteTab) => void }) {
  return (
    <Card>
      <CardHeader title="Set up" subtitle="Get every remote posting path ready to use" />
      <CardBody>
        <ul className="divide-y divide-ink-100">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center justify-between gap-3 py-2.5" data-testid="setup-row">
              <span className="flex items-center gap-2 text-sm text-ink-800">
                {row.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden /> : <Circle className="h-4 w-4 shrink-0 text-ink-300" aria-hidden />}
                <span className="sr-only">{row.done ? "Done:" : "To do:"}</span>
                {row.label}
              </span>
              {!row.done && <Button size="xs" variant="outline" className="remote-tap shrink-0" onClick={() => onNavigate(row.tab)}>{row.cta}</Button>}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** Remote Posting → Overview: KPI tiles, the "needs a caption" queue, a merged activity feed and a
 * setup checklist, all computed client-side from posts, inbound messages and quick-post tokens. */
export function RemoteOverviewTab({ onNavigate }: { onNavigate: (tab: RemoteTab) => void }) {
  const openComposer = useAppStore((s) => s.openComposer);
  const postsQuery = usePosts({ includeUnscheduled: true });
  const messagesQuery = useInboundMessages({ limit: 100 });
  const tokensQuery = useQuickTokens();
  const statusQuery = useInboundStatus();
  const mediaQuery = useMedia();

  const posts = postsQuery.data ?? [];
  const messages = messagesQuery.data ?? [];
  const tokens = tokensQuery.data ?? [];
  const media = mediaQuery.data ?? [];
  const channels = statusQuery.data?.channels ?? [];

  const thumbnailFor = (post: Post): string | null => {
    const asset = media.find((m) => post.mediaIds.includes(m.id));
    return asset ? asset.thumbnailUrl ?? asset.url : null;
  };

  const phonePostsToday = useMemo(() => posts.filter((p) => remoteSourceOf(p) === "phone" && isFromToday(p.createdAt)).length, [posts]);
  const phonePostsLast7 = useMemo(() => posts.filter((p) => remoteSourceOf(p) === "phone" && isWithinLastDays(p.createdAt, 7)).length, [posts]);
  const draftsNeedingCaption = useMemo(() => posts.filter(needsCaption), [posts]);
  const chatMessagesToday = useMemo(() => messages.filter((m) => isFromToday(m.receivedAt)).length, [messages]);
  const failedRemoteToday = useMemo(
    () => posts.filter((p) => remoteSourceOf(p) && p.status === "failed" && isFromToday(p.updatedAt ?? p.createdAt)).length,
    [posts],
  );

  const activity = useMemo<ActivityEntry[]>(() => {
    const fromMessages: ActivityEntry[] = messages.map((m) => ({
      id: `msg-${m.id}`,
      at: m.receivedAt,
      source: "chat",
      label: maskSenderId(m.senderId),
      status: m.status,
      links: m.links.map((l) => ({ platform: l.platform, url: l.url })),
    }));
    const fromPhonePosts: ActivityEntry[] = posts
      .filter((p) => remoteSourceOf(p) === "phone")
      .map((p) => ({
        id: `post-${p.id}`,
        at: p.createdAt,
        source: "phone",
        label: p.title || p.caption.slice(0, 40) || "Untitled post",
        status: p.status,
        links: [],
      }));
    return [...fromMessages, ...fromPhonePosts].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  }, [messages, posts]);

  const setupRows: SetupRow[] = [
    { done: tokens.length > 0, label: "At least one quick-post link exists", tab: "phone", cta: "Create a link" },
    { done: channels.some((c) => c.state === "listening"), label: "A chat channel is listening", tab: "chat", cta: "Set up a channel" },
    { done: statusQuery.data?.transcription.configured ?? false, label: "Voice transcription is configured", tab: "chat", cta: "Configure" },
  ];

  const loading = postsQuery.isLoading || messagesQuery.isLoading || tokensQuery.isLoading || statusQuery.isLoading;

  return (
    <div className="space-y-6">
      {/* Labels stay short enough to fit a phone-width tile without truncating (StatTile clips its label). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className={i === 4 ? "col-span-2 h-[128px] sm:col-span-1" : "h-[128px]"} />)
        ) : (
          <>
            <StatTile label="Phone posts today" value={String(phonePostsToday)} icon={<Smartphone className="h-4 w-4 text-ink-400" aria-hidden />} />
            <StatTile label="Phone posts, 7 days" value={String(phonePostsLast7)} icon={<Smartphone className="h-4 w-4 text-ink-400" aria-hidden />} />
            <StatTile label="Needs a caption" value={String(draftsNeedingCaption.length)} icon={<Camera className="h-4 w-4 text-ink-400" aria-hidden />} />
            <StatTile label="Chat messages today" value={String(chatMessagesToday)} icon={<MessageSquare className="h-4 w-4 text-ink-400" aria-hidden />} />
            <StatTile
              label="Failed today"
              value={String(failedRemoteToday)}
              icon={<AlertCircle className={failedRemoteToday > 0 ? "h-4 w-4 text-red-600" : "h-4 w-4 text-ink-400"} aria-hidden />}
              className="col-span-2 sm:col-span-1"
            />
          </>
        )}
      </div>

      <Card>
        <CardHeader title="Needs a caption" subtitle="Drafts saved without a caption from a phone or a chat channel" />
        <CardBody>
          {postsQuery.isLoading || mediaQuery.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          ) : draftsNeedingCaption.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-8 w-8" />} title="Nothing waiting" description="Every remote draft has a caption." />
          ) : (
            <ul>
              {draftsNeedingCaption.map((post) => (
                <NeedsCaptionRow key={post.id} post={post} thumbnailUrl={thumbnailFor(post)} onOpenComposer={openComposer} />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* items-start keeps the short checklist from stretching to the height of a 20-row feed. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader title="Activity" subtitle="Last 20 remote events" />
          <CardBody>
            {messagesQuery.isLoading || postsQuery.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
            ) : activity.length === 0 ? (
              <EmptyState title="No activity yet" description="Posts from a phone or a chat will show up here." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {activity.map((entry) => {
                  const links = entry.links.filter((l) => l.url);
                  return (
                    <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5" data-testid="activity-row">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-ink-100 text-ink-500" title={REMOTE_SOURCE_LABEL[entry.source]}>
                        {entry.source === "phone" ? <Smartphone className="h-4 w-4" aria-hidden /> : <MessageSquare className="h-4 w-4" aria-hidden />}
                        <span className="sr-only">{REMOTE_SOURCE_LABEL[entry.source]}</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink-800">{entry.label}</p>
                        <p className="text-xs text-ink-500">{relativeTime(entry.at)}</p>
                      </div>
                      {/* On phones the status and links drop under the label so the sender name keeps its width. */}
                      <div className="flex basis-full items-center gap-2 pl-11 sm:basis-auto sm:pl-0">
                        <StatusBadge status={entry.status} />
                        {links.length > 0 && (
                          <div className="flex items-center">
                            {links.map((l, i) => (
                              <a
                                key={`${l.platform}-${i}`}
                                href={l.url!}
                                target="_blank"
                                rel="noreferrer"
                                className="focus-ring inline-flex h-7 w-7 items-center justify-center hover:bg-ink-100"
                                aria-label={`Open on ${PLATFORM_SPECS[l.platform].name}`}
                              >
                                <PlatformIcon platform={l.platform} size={18} />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <SetupChecklist rows={setupRows} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
