import { Bookmark, Heart, MessageCircle, MoreHorizontal, Send, Share2, ThumbsUp } from "lucide-react";
import { FORMAT_SPECS, type MediaAsset, type Platform, type PostFormat } from "@socmedia/shared";
import { cn } from "@/lib/utils";

const MAX_PREVIEW_CHARS = 125;

function truncate(text: string): string {
  if (text.length <= MAX_PREVIEW_CHARS) return text;
  return `${text.slice(0, MAX_PREVIEW_CHARS).trimEnd()}…more`;
}

function MediaBox({ media, format, className }: { media?: MediaAsset; format: PostFormat; className?: string }) {
  const ratio = FORMAT_SPECS[format].ratio;
  return (
    <div className={cn("w-full overflow-hidden bg-ink-200", className)} style={{ aspectRatio: ratio }}>
      {media ? (
        media.kind === "image" ? (
          <img src={media.thumbnailUrl ?? media.url} alt="" className="h-full w-full object-cover" />
        ) : (
          <video src={media.url} className="h-full w-full object-cover" muted />
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-ink-400">No media selected</div>
      )}
    </div>
  );
}

export interface PlatformPreviewProps {
  platform: Platform;
  format: PostFormat;
  title: string;
  caption: string;
  media: MediaAsset[];
  displayName?: string;
  handle?: string;
}

export function PlatformPreview({ platform, format, title, caption, media, displayName, handle }: PlatformPreviewProps) {
  const name = displayName || "Your Page";
  const at = handle || "@yourhandle";
  const primary = media[0];
  const body = truncate(caption);

  if (platform === "instagram") {
    return (
      <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-2xl border border-ink-200 bg-glass" data-testid="preview-instagram">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="h-7 w-7 shrink-0 rounded-full bg-gradient-to-br from-amber-400 via-pink-500 to-purple-500" />
          <span className="text-xs font-semibold text-ink-900">{at.replace(/^@/, "")}</span>
          <MoreHorizontal className="ml-auto h-4 w-4 text-ink-400" />
        </div>
        <MediaBox media={primary} format={format} />
        <div className="flex items-center gap-3 px-3 py-2 text-ink-700">
          <Heart className="h-5 w-5" />
          <MessageCircle className="h-5 w-5" />
          <Send className="h-5 w-5" />
          <Bookmark className="ml-auto h-5 w-5" />
        </div>
        <p className="px-3 pb-3 text-xs leading-relaxed text-ink-800">
          <span className="font-semibold">{at.replace(/^@/, "")}</span> {body}
        </p>
      </div>
    );
  }

  if (platform === "tiktok") {
    return (
      <div className="relative mx-auto w-full max-w-[220px] overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: FORMAT_SPECS.portrait_9_16.ratio }} data-testid="preview-tiktok">
        {primary && primary.kind === "image" ? (
          <img src={primary.thumbnailUrl ?? primary.url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" />
        ) : primary ? (
          <video src={primary.url} className="absolute inset-0 h-full w-full object-cover opacity-90" muted />
        ) : (
          <div className="absolute inset-0 bg-ink-800" />
        )}
        <div className="absolute bottom-16 right-2 flex flex-col items-center gap-4 text-white">
          <Heart className="h-6 w-6" />
          <MessageCircle className="h-6 w-6" />
          <Share2 className="h-6 w-6" />
        </div>
        <div className="absolute inset-x-3 bottom-3 right-14 text-white">
          <p className="text-xs font-semibold">{at.replace(/^@/, "")}</p>
          <p className="line-clamp-2 text-xs">{body}</p>
        </div>
      </div>
    );
  }

  if (platform === "youtube") {
    return (
      <div className="mx-auto w-full max-w-[320px]" data-testid="preview-youtube">
        <MediaBox media={primary} format={format} className="rounded-lg" />
        <div className="mt-2 flex gap-2">
          <div className="h-8 w-8 shrink-0 rounded-full bg-ink-300" />
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-semibold text-ink-900">{title || "Untitled video"}</p>
            <p className="text-xs text-ink-500">{name}</p>
          </div>
        </div>
      </div>
    );
  }

  // linkedin
  return (
    <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-xl border border-ink-200 bg-glass" data-testid="preview-linkedin">
      <div className="flex items-center gap-2 px-3 py-3">
        <div className="h-9 w-9 shrink-0 rounded-full bg-ink-300" />
        <div>
          <p className="text-xs font-semibold text-ink-900">{name}</p>
          <p className="text-[10px] text-ink-400">Now · Public</p>
        </div>
      </div>
      <p className="whitespace-pre-line px-3 pb-2 text-xs text-ink-800">{body}</p>
      <MediaBox media={primary} format={format} />
      <div className="flex items-center gap-4 px-3 py-2 text-ink-500">
        <ThumbsUp className="h-4 w-4" />
        <MessageCircle className="h-4 w-4" />
        <Share2 className="h-4 w-4" />
      </div>
    </div>
  );
}
