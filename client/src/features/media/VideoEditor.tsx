import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Pause, Play, Scissors, Volume2, VolumeX } from "lucide-react";
import { FORMAT_SPECS, type MediaAsset, type Platform, type PostFormat } from "@socmedia/shared";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";
import { SegmentedTabs } from "@/components/ui/Tabs";
import { PlatformIcon } from "@/components/ui/PlatformIcon";
import { useMediaMutations } from "@/hooks/useMedia";
import { cn } from "@/lib/utils";
import { clamp, clampRange, formatTimecode, frameFor, parseTimecode, previewCropStyle, secondsFromPointer, type TrimRange } from "./videoMath";

export interface VideoEditorProps {
  asset: MediaAsset;
  onClose: () => void;
  onDone: (asset: MediaAsset) => void;
  initialFormat?: PostFormat;
}

type ClipMode = "new" | "replace";

/** Presets in the order the design calls for: Square, Vertical, Landscape, Portrait, Link. */
const PRESET_ORDER: PostFormat[] = ["square", "portrait_9_16", "landscape_16_9", "portrait_4_5", "landscape_1_91"];

const PLATFORM_SHORTCUTS: { key: string; label: string; platform: Platform; format: PostFormat }[] = [
  { key: "tiktok", label: "TikTok", platform: "tiktok", format: "portrait_9_16" },
  { key: "youtube", label: "YouTube", platform: "youtube", format: "landscape_16_9" },
  { key: "instagram-reels", label: "IG Reels", platform: "instagram", format: "portrait_9_16" },
  { key: "instagram-feed", label: "IG Feed", platform: "instagram", format: "square" },
  { key: "linkedin", label: "LinkedIn", platform: "linkedin", format: "square" },
];

const MAX_LENGTH = 300;
const MIN_LENGTH = 0.5;

const chipBase = "rounded-full border px-3 py-1 text-xs font-medium transition-colors";
const chipActive = "border-brand-500 bg-brand-50 text-brand-700";
const chipInactive = "border-ink-200 text-ink-600 hover:bg-ink-50";

export function VideoEditor({ asset, onClose, onDone, initialFormat }: VideoEditorProps) {
  const { clip } = useMediaMutations();
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const initialDuration = asset.durationSeconds ?? 0;
  const [duration, setDuration] = useState(initialDuration);
  const [naturalSize, setNaturalSize] = useState({ width: asset.width ?? 0, height: asset.height ?? 0 });
  const [range, setRangeState] = useState<TrimRange>(() => clampRange({ start: 0, end: initialDuration }, initialDuration, MAX_LENGTH, MIN_LENGTH));
  const [startText, setStartText] = useState(() => formatTimecode(range.start));
  const [endText, setEndText] = useState(() => formatTimecode(range.end));
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(false);
  const [format, setFormat] = useState<PostFormat | null>(initialFormat ?? null);
  const [stripAudio, setStripAudio] = useState(false);
  const [mode, setMode] = useState<ClipMode>("new");
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [splitting, setSplitting] = useState(false);

  const setRange = (next: TrimRange) => {
    setRangeState(next);
    setStartText(formatTimecode(next.start));
    setEndText(formatTimecode(next.end));
  };

  // Re-clamp once real metadata duration is known (it may differ slightly from the stored value).
  useEffect(() => {
    setRangeState((r) => {
      const next = clampRange(r, duration, MAX_LENGTH, MIN_LENGTH);
      setStartText(formatTimecode(next.start));
      setEndText(formatTimecode(next.end));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = previewMuted;
  }, [previewMuted]);

  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : duration;
    setDuration(d);
    setNaturalSize({ width: v.videoWidth || asset.width || 0, height: v.videoHeight || asset.height || 0 });
  };

  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    if (v.currentTime >= range.end) v.currentTime = range.start;
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < range.start || v.currentTime >= range.end) v.currentTime = range.start;
      void v.play();
    } else {
      v.pause();
    }
  };

  const moveStart = (next: number) => setRange(clampRange({ start: next, end: range.end }, duration, MAX_LENGTH, MIN_LENGTH));
  const moveEnd = (next: number) => {
    const desired = clamp(next, range.start + MIN_LENGTH, duration);
    setRange(clampRange({ start: range.start, end: desired }, duration, MAX_LENGTH, MIN_LENGTH));
  };

  const commitStart = () => {
    const parsed = parseTimecode(startText);
    if (parsed == null) { setStartText(formatTimecode(range.start)); return; }
    moveStart(parsed);
  };
  const commitEnd = () => {
    const parsed = parseTimecode(endText);
    if (parsed == null) { setEndText(formatTimecode(range.end)); return; }
    moveEnd(parsed);
  };

  const setStartToPlayhead = () => moveStart(currentTime);
  const setEndToPlayhead = () => moveEnd(currentTime);

  const handlePointerDown = (which: "start" | "end") => (e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as unknown as { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
    setDragging(which);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const t = secondsFromPointer(e.clientX, rect, duration);
    if (dragging === "start") moveStart(t);
    else moveEnd(t);
  };
  const handlePointerUp = () => setDragging(null);

  const handleKeyDown = (which: "start" | "end") => (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 5 : 0.5;
    let delta = 0;
    if (e.key === "ArrowLeft") delta = -step;
    else if (e.key === "ArrowRight") delta = step;
    else return;
    e.preventDefault();
    if (which === "start") moveStart(range.start + delta);
    else moveEnd(range.end + delta);
  };

  const selectedLength = range.end - range.start;
  const overLength = selectedLength > MAX_LENGTH;
  const outputSize = frameFor(format) ?? (naturalSize.width && naturalSize.height ? naturalSize : null);
  const cropStyle = previewCropStyle(naturalSize.width, naturalSize.height, format);
  const pct = (t: number) => (duration > 0 ? clamp((t / duration) * 100, 0, 100) : 0);

  const handleSubmit = () => {
    setError(null);
    clip.mutate(
      { id: asset.id, input: { start: range.start, end: range.end, format, mode, muted: stripAudio } },
      {
        onSuccess: (result) => {
          toast.success(mode === "replace" ? "Video replaced" : "Clip saved to library");
          onDone(result);
        },
        onError: (err) => {
          const message = (err as Error).message || "Something went wrong";
          setError(message);
          toast.error(mode === "replace" ? "Replace failed" : "Clip failed", { description: message });
        },
      },
    );
  };

  const handleSplit = async () => {
    if (currentTime <= range.start + MIN_LENGTH || currentTime >= range.end - MIN_LENGTH) {
      toast.error("Move the playhead inside the selected range first");
      return;
    }
    if (!window.confirm(`Split into two clips at ${formatTimecode(currentTime)}?`)) return;
    setSplitting(true);
    setError(null);
    try {
      await clip.mutateAsync({ id: asset.id, input: { start: range.start, end: currentTime, format, mode: "new", muted: stripAudio } });
      const second = await clip.mutateAsync({ id: asset.id, input: { start: currentTime, end: range.end, format, mode: "new", muted: stripAudio } });
      toast.success("Split into two clips");
      onDone(second);
    } catch (err) {
      const message = (err as Error).message || "Something went wrong";
      setError(message);
      toast.error("Split failed", { description: message });
    } finally {
      setSplitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`Edit ${asset.filename}`}
      description="Trim, crop and export a platform-ready clip."
      footer={
        <div className="flex w-full items-center justify-between">
          <Button variant="ghost" size="sm" icon={<Scissors className="h-3.5 w-3.5" />} onClick={() => void handleSplit()} loading={splitting} disabled={clip.isPending}>
            Split at playhead
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleSubmit} loading={clip.isPending} data-testid="video-editor-submit">
              {clip.isPending ? "Rendering…" : mode === "replace" ? "Replace video" : "Create clip"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-5">
        {/* Left: preview, transport, trim bar */}
        <div className="space-y-3 min-w-0">
          <div
            data-testid="video-frame"
            data-format={format ?? "original"}
            className="relative mx-auto w-full max-w-md overflow-hidden bg-black ring-1 ring-ink-200"
            style={{ aspectRatio: cropStyle.aspectRatio }}
          >
            <video
              ref={videoRef}
              src={asset.url}
              preload="metadata"
              playsInline
              muted={previewMuted}
              className="h-full w-full"
              style={{ objectFit: cropStyle.objectFit }}
              onLoadedMetadata={onLoadedMetadata}
              onTimeUpdate={onTimeUpdate}
            />
          </div>

          <div className="flex items-center gap-3 text-sm text-ink-600">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play"}
              icon={playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            />
            <span className="tabular-nums" data-testid="playhead-time">{formatTimecode(currentTime)} / {formatTimecode(duration)}</span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setPreviewMuted((m) => !m)}
              aria-label={previewMuted ? "Unmute preview" : "Mute preview"}
              icon={previewMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            />
          </div>

          <div className="space-y-2">
            <div ref={trackRef} className="relative h-8 rounded-none bg-ink-100" data-testid="trim-track">
              <div
                className="absolute top-0 h-full bg-brand-200"
                style={{ left: `${pct(range.start)}%`, width: `${Math.max(0, pct(range.end) - pct(range.start))}%` }}
              />
              <div
                role="slider"
                tabIndex={0}
                aria-label="Trim start"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={range.start}
                data-testid="trim-handle-start"
                className="absolute top-0 h-full w-2 cursor-ew-resize bg-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                style={{ left: `calc(${pct(range.start)}% - 4px)` }}
                onPointerDown={handlePointerDown("start")}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onKeyDown={handleKeyDown("start")}
              />
              <div
                role="slider"
                tabIndex={0}
                aria-label="Trim end"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={range.end}
                data-testid="trim-handle-end"
                className="absolute top-0 h-full w-2 cursor-ew-resize bg-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                style={{ left: `calc(${pct(range.end)}% - 4px)` }}
                onPointerDown={handlePointerDown("end")}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onKeyDown={handleKeyDown("end")}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1">
                Start
                <input
                  className="input w-24"
                  value={startText}
                  onChange={(e) => setStartText(e.target.value)}
                  onBlur={commitStart}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitStart(); } }}
                  aria-label="Start time"
                />
              </label>
              <Button type="button" variant="outline" size="xs" onClick={setStartToPlayhead}>Set start to playhead</Button>
              <label className="flex items-center gap-1">
                End
                <input
                  className="input w-24"
                  value={endText}
                  onChange={(e) => setEndText(e.target.value)}
                  onBlur={commitEnd}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitEnd(); } }}
                  aria-label="End time"
                />
              </label>
              <Button type="button" variant="outline" size="xs" onClick={setEndToPlayhead}>Set end to playhead</Button>
            </div>
            <p className={cn("text-xs", overLength ? "text-red-600 font-semibold" : "text-ink-500")} data-testid="selection-length">
              Selected: {formatTimecode(selectedLength)}{overLength ? " — too long" : ""}
            </p>
            <p className="text-xs text-ink-400">Clips are limited to 5:00 for now.</p>
          </div>
        </div>

        {/* Right: format, platform shortcuts, audio, summary, mode */}
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-900">Format</h3>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setFormat(null)} className={cn(chipBase, format === null ? chipActive : chipInactive)}>
                Original
              </button>
              {PRESET_ORDER.map((f) => (
                <button key={f} type="button" onClick={() => setFormat(f)} className={cn(chipBase, format === f ? chipActive : chipInactive)}>
                  {FORMAT_SPECS[f].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-900">Platform shortcuts</h3>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORM_SHORTCUTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setFormat(s.format)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-600 hover:bg-ink-50"
                >
                  <PlatformIcon platform={s.platform} size={16} mono />
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-ink-200 p-3">
            <div>
              <p className="text-sm font-medium text-ink-900">Strip audio</p>
              <p className="text-xs text-ink-500">Mute the exported clip</p>
            </div>
            <Toggle checked={stripAudio} onChange={setStripAudio} label="Strip audio" />
          </div>

          <div className="rounded-lg border border-ink-200 p-3 space-y-1 text-xs text-ink-600" data-testid="clip-summary">
            <p>Source duration: {formatTimecode(duration)}</p>
            <p>Selected range: {formatTimecode(range.start)} – {formatTimecode(range.end)} ({formatTimecode(selectedLength)})</p>
            <p>Output size: {outputSize ? `${outputSize.width}×${outputSize.height}` : "Source size"}</p>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-900">Save as</h3>
            <SegmentedTabs<ClipMode>
              value={mode}
              onChange={setMode}
              items={[{ id: "new", label: "Create new clip" }, { id: "replace", label: "Replace original" }]}
            />
          </div>

          {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
        </div>
      </div>
    </Modal>
  );
}
