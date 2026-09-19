import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Film, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { MediaAsset, Post } from "@socmedia/shared";
import { EmptyState, PlatformIcon, SegmentedTabs, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";

function DraggableMedia({ asset }: { asset: MediaAsset }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `media-${asset.id}`,
    data: { kind: "media", asset },
  });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 }}
      className="relative aspect-square cursor-grab overflow-hidden rounded-lg border border-ink-200 bg-ink-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
      aria-label={`Drag ${asset.filename} onto the calendar to schedule it`}
    >
      {asset.thumbnailUrl || asset.url ? (
        <img src={asset.thumbnailUrl ?? asset.url} alt="" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ink-400">
          <Film className="h-5 w-5" aria-hidden />
        </div>
      )}
      {asset.kind === "video" && (
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-semibold uppercase text-white">Video</span>
      )}
    </button>
  );
}

function DraggableDraft({ post }: { post: Post }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `post-${post.id}`,
    data: { kind: "post", post },
  });
  const excerpt = post.caption.trim() || "No caption yet";
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 }}
      className="cursor-grab rounded-lg border border-ink-200 bg-glass p-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
      aria-label={`Drag draft "${post.title.trim() || excerpt}" onto the calendar to schedule it`}
    >
      <p className="truncate text-xs font-semibold text-ink-800">{post.title.trim() || "Untitled draft"}</p>
      <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-500">{excerpt}</p>
      <div className="mt-1.5 flex items-center gap-1">
        {post.targets.map((t) => (
          <PlatformIcon key={t.platform} platform={t.platform} size={16} />
        ))}
      </div>
    </div>
  );
}

export interface CreativeSidebarProps {
  media: MediaAsset[];
  mediaLoading: boolean;
  drafts: Post[];
  draftsLoading: boolean;
}

export function CreativeSidebar({ media, mediaLoading, drafts, draftsLoading }: CreativeSidebarProps) {
  const [tab, setTab] = useState<"media" | "drafts">("media");
  const [query, setQuery] = useState("");

  const filteredMedia = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return media;
    return media.filter((m) => m.filename.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q)));
  }, [media, query]);

  const filteredDrafts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return drafts;
    return drafts.filter((p) => `${p.title} ${p.caption}`.toLowerCase().includes(q));
  }, [drafts, query]);

  return (
    <aside className="card flex w-72 shrink-0 flex-col overflow-hidden">
      <div className="space-y-3 border-b border-ink-100 p-3">
        <h2 className="text-sm font-semibold text-ink-900">Creative &amp; Drafts</h2>
        <SegmentedTabs
          items={[
            { id: "media", label: "Media" },
            { id: "drafts", label: "Drafts" },
          ]}
          value={tab}
          onChange={setTab}
          className="w-full"
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === "media" ? "Search media…" : "Search drafts…"}
            aria-label={tab === "media" ? "Search media" : "Search drafts"}
            className={cn("input h-8 pl-8 text-xs")}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
        {tab === "media" ? (
          mediaLoading ? (
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square" />
              ))}
            </div>
          ) : filteredMedia.length === 0 ? (
            <EmptyState title="No media yet" description="Upload photos or video to drag them onto the calendar." />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {filteredMedia.map((asset) => (
                <DraggableMedia key={asset.id} asset={asset} />
              ))}
            </div>
          )
        ) : draftsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : filteredDrafts.length === 0 ? (
          <EmptyState title="No drafts" description="Draft, unapproved, and approved posts without a date show up here." />
        ) : (
          <div className="space-y-2">
            {filteredDrafts.map((post) => (
              <DraggableDraft key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
