import { useState } from "react";
import { Film, ImagePlus, Pencil, Trash2 } from "lucide-react";
import { FORMAT_SPECS, type MediaAsset } from "@socmedia/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

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
  onTagsChange,
}: {
  asset: MediaAsset;
  onEdit?: (asset: MediaAsset) => void;
  onUse?: (asset: MediaAsset) => void;
  onDelete?: (asset: MediaAsset) => void;
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
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-400">
            <Film className="h-8 w-8" />
          </div>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <Badge tone="neutral" className={cn(asset.kind === "video" ? "bg-black/60 text-white" : "")}>{asset.kind}</Badge>
          {asset.format && <Badge tone="info">Derived · {FORMAT_SPECS[asset.format].label}</Badge>}
        </div>
        <div className="absolute right-2 top-2 flex gap-1">
          {asset.kind === "image" && onEdit && (
            <button
              type="button"
              aria-label={`Edit ${asset.filename}`}
              onClick={() => onEdit(asset)}
              className="rounded-md glass-sheet p-1.5 text-ink-600 shadow hover:bg-glass-strong"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              aria-label={`Delete ${asset.filename}`}
              onClick={() => { if (window.confirm(`Delete ${asset.filename}?`)) onDelete(asset); }}
              className="rounded-md glass-sheet p-1.5 text-ink-600 shadow hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-2 p-3">
        <p className="truncate text-sm font-medium text-ink-900" title={asset.filename}>{asset.filename}</p>
        <p className="text-xs text-ink-500">
          {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}
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
