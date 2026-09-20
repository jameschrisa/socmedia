import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Inbox, Pencil, SearchX, Trash2 } from "lucide-react";
import { PLATFORM_SPECS, type InboundMessage, type JobStatus, type Platform, type Post, type PublishJob } from "@socmedia/shared";
import { Button, Card, CardBody, EmptyState, Modal, PlatformIcon, SegmentedTabs, Select, Skeleton, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useCurrentOrgId } from "@/hooks/useOrg";
import { usePosts, usePostMutations } from "@/hooks/usePosts";
import { useMedia } from "@/hooks/useMedia";
import { useInboundMessages } from "@/hooks/useInbound";
import { useAppStore } from "@/store/appStore";
import { formatDateTime } from "@/lib/utils";
import { SourceBadge } from "./SourceBadge";
import { remoteSourceOf, type RemoteSource } from "./remoteUtils";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

type SourceFilter = "all" | RemoteSource;

interface AccountLink {
  platform: Platform;
  url: string | null;
  status: JobStatus | InboundMessage["status"];
}

function linksFor(post: Post, jobsByPost: Map<string, PublishJob[]>, messageByPost: Map<string, InboundMessage>): AccountLink[] {
  const message = messageByPost.get(post.id);
  if (message) return message.links.map((l) => ({ platform: l.platform, url: l.url, status: l.status }));
  const jobs = jobsByPost.get(post.id) ?? [];
  return jobs.map((j) => ({ platform: j.platform, url: j.externalUrl ?? null, status: j.status }));
}

/** Remote Posting → Remote posts: every post created from a phone link or a chat channel, with the
 * per-account links each one produced, filterable by source and status. */
export function RemotePostsTable() {
  const orgId = useCurrentOrgId();
  const openComposer = useAppStore((s) => s.openComposer);
  const postsQuery = usePosts({ includeUnscheduled: true });
  const mediaQuery = useMedia();
  const messagesQuery = useInboundMessages({ limit: 200 });
  const jobsQuery = useQuery({ queryKey: qk.jobs(orgId, { scope: "remote" }), queryFn: () => api.jobs.list({}), enabled: !!orgId });
  const { duplicate, remove } = usePostMutations();

  const [source, setSource] = useState<SourceFilter>("all");
  const [status, setStatus] = useState<string>("all");
  const [deleteTarget, setDeleteTarget] = useState<Post | null>(null);

  const posts = postsQuery.data ?? [];
  const media = mediaQuery.data ?? [];
  const messages = messagesQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];

  const remotePosts = useMemo(() => posts.filter((p) => remoteSourceOf(p) !== null), [posts]);

  const jobsByPost = useMemo(() => {
    const map = new Map<string, PublishJob[]>();
    for (const job of jobs) map.set(job.postId, [...(map.get(job.postId) ?? []), job]);
    return map;
  }, [jobs]);

  const messageByPost = useMemo(() => {
    const map = new Map<string, InboundMessage>();
    for (const m of messages) if (m.postId) map.set(m.postId, m);
    return map;
  }, [messages]);

  const statuses = useMemo(() => [...new Set(remotePosts.map((p) => p.status))].sort(), [remotePosts]);

  const filtered = useMemo(
    () => remotePosts.filter((p) => (source === "all" || remoteSourceOf(p) === source) && (status === "all" || p.status === status)),
    [remotePosts, source, status],
  );
  const filtersActive = source !== "all" || status !== "all";

  const thumbnailFor = (post: Post): string | null => {
    const asset = media.find((m) => post.mediaIds.includes(m.id));
    return asset ? asset.thumbnailUrl ?? asset.url : null;
  };

  const captionSnippet = (post: Post): string => {
    const text = post.caption.trim();
    if (!text) return "No caption yet";
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    remove.mutate(deleteTarget.id, {
      onSuccess: () => { toast.success("Post deleted"); setDeleteTarget(null); },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const loading = postsQuery.isLoading || mediaQuery.isLoading || messagesQuery.isLoading || jobsQuery.isLoading;

  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="remote-tap-tabs">
            <SegmentedTabs<SourceFilter>
              value={source}
              onChange={setSource}
              items={[{ id: "all", label: "All sources" }, { id: "phone", label: "Phone" }, { id: "chat", label: "Chat" }]}
            />
          </div>
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="remote-tap w-auto">
            <option value="all">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </Select>
        </div>

        {loading ? (
          <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
        ) : remotePosts.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-8 w-8" />}
            title="No remote posts yet"
            description="Posts created from a phone link or a linked chat show up here. Create a phone link or set up a chat channel to get started."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<SearchX className="h-8 w-8" />}
            title="No posts match these filters"
            description={`${remotePosts.length} remote ${remotePosts.length === 1 ? "post is" : "posts are"} hidden by the source or status filter.`}
            action={filtersActive && <Button variant="outline" size="sm" className="remote-tap" onClick={() => { setSource("all"); setStatus("all"); }}>Clear filters</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="remote-stack-table remote-posts-table w-full text-left">
              <thead>
                <tr className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-3 font-medium">Post</th>
                  <th className="py-2 pr-3 font-medium">Source</th>
                  <th className="py-2 pr-3 font-medium">Targets</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Created</th>
                  <th className="py-2 pr-3 font-medium">Links</th>
                  <th className="py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((post) => {
                  const postSource = remoteSourceOf(post)!;
                  const thumb = thumbnailFor(post);
                  const links = linksFor(post, jobsByPost, messageByPost).filter((l) => l.url);
                  return (
                    <tr key={post.id} className="border-b border-ink-100 last:border-0" data-testid="remote-post-row">
                      <td className="cell-post py-2.5 pr-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden bg-ink-100 text-ink-300">
                            {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <Inbox className="h-4 w-4" aria-hidden />}
                          </div>
                          <p className="min-w-0 max-w-xs truncate text-sm text-ink-800" title={post.caption.trim() || undefined}>{captionSnippet(post)}</p>
                        </div>
                      </td>
                      <td className="cell-source py-2.5 pr-3"><SourceBadge source={postSource} /></td>
                      <td className="cell-targets py-2.5 pr-3">
                        <div className="flex -space-x-1" aria-label={`Targets: ${[...new Set(post.targets.map((t) => PLATFORM_SPECS[t.platform].name))].join(", ")}`}>
                          {[...new Set(post.targets.map((t) => t.platform))].map((p) => <PlatformIcon key={p} platform={p} size={22} className="ring-2 ring-canvas" />)}
                        </div>
                      </td>
                      <td className="cell-status py-2.5 pr-3"><StatusBadge status={post.status} /></td>
                      <td className="cell-created py-2.5 pr-3 text-sm text-ink-600 whitespace-nowrap">{formatDateTime(post.createdAt)}</td>
                      <td className="cell-links py-2.5 pr-3">
                        {links.length === 0 ? (
                          <span className="text-xs text-ink-400">No links yet</span>
                        ) : (
                          <div className="flex flex-wrap items-center" aria-label="Published links">
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
                      </td>
                      <td className="cell-actions py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="xs" className="remote-tap remote-tap-icon" onClick={() => openComposer(post.id)} aria-label="Open in composer" title="Open in composer"><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            className="remote-tap remote-tap-icon"
                            onClick={() => duplicate.mutate(post.id, { onSuccess: () => toast.success("Post duplicated"), onError: (e) => toast.error(errorMessage(e)) })}
                            loading={duplicate.isPending && duplicate.variables === post.id}
                            aria-label="Duplicate"
                            title="Duplicate"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="xs" onClick={() => setDeleteTarget(post)} aria-label="Delete" title="Delete" className="remote-tap remote-tap-icon text-red-600 hover:bg-red-50">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete this post?"
        description="This can't be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={confirmDelete}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-ink-500">{deleteTarget ? captionSnippet(deleteTarget) : ""}</p>
      </Modal>
    </Card>
  );
}
