import { useState } from "react";
import { Copy, Film, ImagePlus, Pencil, Play, Scissors, Trash2 } from "lucide-react";
import { FORMAT_SPECS, type MediaAsset } from "@socmedia/shared";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { formatTimecode } from "./videoMath";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaCard({
  asset,
  onEdit,
  onUse,
  onDelete,
  onDuplicate,
  onTagsChange,
}: {
  asset: MediaAsset;
  onEdit?: (asset: MediaAsset) => void;
  onUse?: (asset: MediaAsset) => void;
  onDelete?: (asset: MediaAsset) => void;
  onDuplicate?: (asset: MediaAsset) => void;
  onTagsChange?: (tags: string[]) => void;
}) {
  const [tagDraft, setTagDraft] = useState(asset.tags.join(", "));

  const commitTags = () => {
    const next = tagDraft.split(",").map((t) => t.trim()).filter(Boolean);
    if (next.join(",") !== asset.tags.join(",")) onTagsChange?.(next);
  };

  return (
    <div className="card card-hover overflow-hidden flex flex-col" data-testid="media-card" data-asset-id={asset.id}>
      <div className="relative aspect-square bg-ink-100">
        {asset.kind === "image" ? (
          <img src={asset.thumbnailUrl ?? asset.url} alt={asset.filename} className="h-full w-full object-cover" />
        ) : asset.thumbnailUrl ? (
          <>
            <img src={asset.thumbnailUrl} alt={asset.filename} className="h-full w-full object-cover" />
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white">
                <Play className="h-4 w-4 translate-x-0.5" fill="currentColor" />
              </span>
            </div>
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-400">
            <Film className="h-8 w-8" />
          </div>
        )}
        {/* top scrim so badges and controls read on bright imagery */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/70 via-black/35 to-transparent" />
        <div className="absolute left-2.5 top-2.5 flex flex-wrap gap-1">
          <span className="media-chip">{asset.kind}</span>
          {asset.format && <span className="media-chip text-cyan-400">Derived · {FORMAT_SPECS[asset.format].label}</span>}
        </div>
        <div className="absolute right-2.5 top-2.5 flex gap-1.5">
          {asset.kind === "image" && onEdit && (
            <button
              type="button"
              aria-label={`Edit ${asset.filename}`}
              title="Edit image"
              onClick={() => onEdit(asset)}
              className="media-action"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {asset.kind === "video" && onEdit && (
            <button
              type="button"
              aria-label={`Edit ${asset.filename}`}
              title="Trim and crop video"
              onClick={() => onEdit(asset)}
              className="media-action"
            >
              <Scissors className="h-4 w-4" />
            </button>
          )}
          {onDuplicate && (
            <button
              type="button"
              aria-label={`Duplicate ${asset.filename}`}
              title="Duplicate"
              onClick={() => onDuplicate(asset)}
              className="media-action"
            >
              <Copy className="h-4 w-4" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              aria-label={`Delete ${asset.filename}`}
              title="Delete"
              onClick={() => { if (window.confirm(`Delete ${asset.filename}?`)) onDelete(asset); }}
              className="media-action media-action-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-2 p-3">
        <p className="truncate text-sm font-medium text-ink-900" title={asset.filename}>{asset.filename}</p>
        <p className="text-xs text-ink-500">
          {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}
          {asset.kind === "video" && asset.durationSeconds != null ? `${formatTimecode(asset.durationSeconds)} · ` : ""}
          {formatSize(asset.size)}
        </p>
        <input
          className="input text-xs"
          placeholder="tags, comma, separated"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onBlur={commitTags}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitTags(); (e.target as HTMLInputElement).blur(); } }}
          aria-label={`Tags for ${asset.filename}`}
        />
        {onUse && (
          <Button variant="secondary" size="sm" className="w-full" icon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => onUse(asset)}>
            Use in post
          </Button>
        )}
      </div>
    </div>
  );
}
