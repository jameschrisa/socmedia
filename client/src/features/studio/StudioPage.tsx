import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Search, UploadCloud } from "lucide-react";
import type { MediaAsset } from "@socmedia/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, SectionTitle } from "@/components/ui/Card";
import { EmptyState, Skeleton } from "@/components/ui/Skeleton";
import { SegmentedTabs } from "@/components/ui/Tabs";
import { StatusBadge } from "@/components/ui/Badge";
import { useMedia, useMediaMutations } from "@/hooks/useMedia";
import { usePosts } from "@/hooks/usePosts";
import { useAppStore } from "@/store/appStore";
import { cn, formatDateTime } from "@/lib/utils";
import { ImageEditor, type ImageEditorExportResult } from "@/features/media/ImageEditor";
import { MediaCard } from "@/features/media/MediaCard";

type KindFilter = "all" | "image" | "video";

export function StudioPage() {
  const { data: media, isLoading: mediaLoading } = useMedia();
  const { upload, exportDataUrl, update, remove } = useMediaMutations();
  const { data: posts, isLoading: postsLoading } = usePosts({ includeUnscheduled: true });
  const openComposer = useAppStore((s) => s.openComposer);

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editingAsset, setEditingAsset] = useState<MediaAsset | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    (media ?? []).forEach((m) => m.tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [media]);

  const filteredMedia = useMemo(() => {
    return (media ?? []).filter((m) => {
      if (kind !== "all" && m.kind !== kind) return false;
      if (activeTag && !m.tags.includes(activeTag)) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!m.filename.toLowerCase().includes(q) && !m.tags.some((t) => t.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [media, kind, activeTag, search]);

  const recentPosts = useMemo(() => {
    return [...(posts ?? [])].sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)).slice(0, 8);
  }, [posts]);

  const uploadFiles = (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (list.length === 0) return;
    list.forEach((file) => {
      upload.mutate(
        { file },
        {
          onError: (err) => toast.error(`Upload failed for ${file.name}`, { description: (err as Error).message }),
          onSuccess: () => toast.success(`Uploaded ${file.name}`),
        },
      );
    });
  };

  const handleExport = (result: ImageEditorExportResult) => {
    if (!editingAsset) return;
    const base = editingAsset.filename.replace(/\.[^.]+$/, "");
    exportDataUrl.mutate(
      { dataUrl: result.dataUrl, filename: `${base}-${result.format}.jpg`, sourceAssetId: editingAsset.id, format: result.format, tags: [result.format] },
      {
        onSuccess: () => toast.success("Export saved to media library"),
        onError: (err) => toast.error("Export failed", { description: (err as Error).message }),
      },
    );
    setEditingAsset(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Studio</h1>
          <p className="text-sm text-ink-500">Manage media, edit creative and jump back into recent posts.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ""; }}
          />
          <Button variant="primary" icon={<UploadCloud className="h-4 w-4" />} onClick={() => fileInputRef.current?.click()} loading={upload.isPending}>
            Upload
          </Button>
        </div>
      </div>

      <Card
        className={cn("border-2 border-dashed transition-colors", dragOver ? "border-brand-400 bg-brand-50" : "border-ink-200")}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
        }}
        data-testid="upload-dropzone"
      >
        <CardBody className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <UploadCloud className="h-6 w-6 text-ink-400" />
          <p className="text-sm text-ink-600">Drag and drop images or video here, or use the Upload button.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Media library"
          action={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
                <input className="input pl-8 w-56" placeholder="Search media…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search media" />
              </div>
              <SegmentedTabs
                items={[{ id: "all", label: "All" }, { id: "image", label: "Images" }, { id: "video", label: "Videos" }]}
                value={kind}
                onChange={(v) => setKind(v as KindFilter)}
              />
            </div>
          }
        />
        <CardBody className="space-y-4">
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setActiveTag((cur) => (cur === t ? null : t))}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium",
                    activeTag === t ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200 text-ink-600 hover:bg-ink-50",
                  )}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}

          {mediaLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 items-start">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-square" />)}
            </div>
          ) : filteredMedia.length === 0 ? (
            <EmptyState icon={<ImagePlus className="h-8 w-8" />} title="No media found" description="Upload an image or video to get started." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 items-start">
              {filteredMedia.map((asset) => (
                <MediaCard
                  key={asset.id}
                  asset={asset}
                  onEdit={setEditingAsset}
                  onUse={(a) => openComposer(null, { mediaIds: [a.id] })}
                  onDelete={(a) => remove.mutate(a.id, { onSuccess: () => toast.success(`Deleted ${a.filename}`) })}
                  onTagsChange={(tags) => update.mutate({ id: asset.id, tags })}
                />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recent posts" subtitle="Everything you've drafted, scheduled or published recently." />
        <CardBody>
          {postsLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : recentPosts.length === 0 ? (
            <EmptyState title="No posts yet" description="Create your first post to see it here." action={<Button onClick={() => openComposer(null)}>New post</Button>} />
          ) : (
            <ul className="divide-y divide-ink-100">
              {recentPosts.map((post) => (
                <li key={post.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">{post.title || post.caption || "Untitled post"}</p>
                    <p className="text-xs text-ink-500">{post.scheduledAt ? formatDateTime(post.scheduledAt) : "Not scheduled"}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <StatusBadge status={post.status} />
                    <Button variant="outline" size="sm" onClick={() => openComposer(post.id)}>Edit</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {editingAsset && (
        <ImageEditor
          asset={editingAsset}
          initialFormat={editingAsset.format ?? "square"}
          onExport={handleExport}
          onClose={() => setEditingAsset(null)}
        />
      )}
    </div>
  );
}
