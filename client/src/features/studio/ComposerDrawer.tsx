import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Sparkles, Trash2, UploadCloud, X } from "lucide-react";
import {
  commonFormats,
  composeCaption,
  effectiveCaption,
  extractHashtags,
  FORMAT_SPECS,
  hasErrors,
  PLATFORM_SPECS,
  validatePost,
  type MediaAsset,
  type Platform,
  type Post,
  type PostFormat,
  type PostInput,
  type PostTarget,
  type PlatformConnection,
} from "@socmedia/shared";
import { Drawer } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { PlatformIcon } from "@/components/ui/PlatformIcon";
import { SegmentedTabs } from "@/components/ui/Tabs";
import { TimeScroller, formatMinutes, minutesOfDay, withMinutesOfDay } from "@/components/ui/TimeScroller";
import { useConnections } from "@/hooks/useConnections";
import { useMedia, useMediaMutations } from "@/hooks/useMedia";
import { usePost, usePostMutations } from "@/hooks/usePosts";
import { useAppStore, type ComposerDefaults } from "@/store/appStore";
import { useAiBridge } from "@/features/ai/aiBridge";
import { cn } from "@/lib/utils";
import { ImageEditor, type ImageEditorExportResult } from "@/features/media/ImageEditor";
import { MediaPicker } from "@/features/media/MediaPicker";
import { PlatformPreview } from "./PlatformPreview";

interface FormState {
  title: string;
  caption: string;
  hashtags: string[];
  mediaIds: string[];
  targets: PostTarget[];
  labels: string[];
  notes: string;
  mode: "draft" | "schedule";
  requiresApproval: boolean;
  scheduledDate: string; // yyyy-MM-dd
  scheduledMinutes: number; // minutes since midnight
}

function pad(n: number): string { return String(n).padStart(2, "0"); }
function toDateInputValue(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function blankForm(): FormState {
  const now = new Date();
  return {
    title: "",
    caption: "",
    hashtags: [],
    mediaIds: [],
    targets: [],
    labels: [],
    notes: "",
    mode: "draft",
    requiresApproval: false,
    scheduledDate: toDateInputValue(now),
    scheduledMinutes: minutesOfDay(now),
  };
}

function formFromDefaults(defaults: ComposerDefaults): FormState {
  const base = blankForm();
  if (defaults.scheduledAt) {
    const d = new Date(defaults.scheduledAt);
    if (!Number.isNaN(d.getTime())) {
      return { ...base, mode: "schedule", scheduledDate: toDateInputValue(d), scheduledMinutes: minutesOfDay(d), mediaIds: defaults.mediaIds ?? [] };
    }
  }
  return { ...base, mediaIds: defaults.mediaIds ?? [] };
}

function formFromPost(post: Post): FormState {
  const hasSchedule = !!post.scheduledAt;
  const d = post.scheduledAt ? new Date(post.scheduledAt) : new Date();
  return {
    title: post.title,
    caption: post.caption,
    hashtags: post.hashtags,
    mediaIds: post.mediaIds,
    targets: post.targets,
    labels: post.labels,
    notes: post.notes,
    mode: hasSchedule ? "schedule" : "draft",
    requiresApproval: post.status === "needs_approval",
    scheduledDate: toDateInputValue(d),
    scheduledMinutes: minutesOfDay(d),
  };
}

function computeScheduledIso(dateStr: string, minutes: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const local = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return withMinutesOfDay(local, minutes).toISOString();
}

export function ComposerDrawer() {
  const composerOpen = useAppStore((s) => s.composerOpen);
  const composerPostId = useAppStore((s) => s.composerPostId);
  const composerDefaults = useAppStore((s) => s.composerDefaults);
  const closeComposer = useAppStore((s) => s.closeComposer);

  const { data: post } = usePost(composerPostId);
  const { data: connections } = useConnections();
  const { data: media } = useMedia();
  const { create, update, remove, schedule, publish } = usePostMutations();
  const { upload, exportDataUrl } = useMediaMutations();

  const pending = useAiBridge((s) => s.pending);
  const consume = useAiBridge((s) => s.consume);
  const setAiContext = useAiBridge((s) => s.setContext);

  const [form, setForm] = useState<FormState>(blankForm);
  const [savedId, setSavedId] = useState<string | null>(composerPostId);
  const [activePlatform, setActivePlatform] = useState<Platform | null>(null);
  const [expandedCustomize, setExpandedCustomize] = useState<Set<Platform>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<MediaAsset | null>(null);
  const [hashtagDraft, setHashtagDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const wasOpen = useRef(false);

  // Reset the form whenever the drawer opens.
  useEffect(() => {
    if (composerOpen && !wasOpen.current) {
      wasOpen.current = true;
      setSavedId(composerPostId);
      setExpandedCustomize(new Set());
      setActivePlatform(null);
      if (!composerPostId) setForm(formFromDefaults(composerDefaults));
    }
    if (!composerOpen) wasOpen.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerOpen]);

  // Hydrate from the loaded post once it's available (edit mode).
  useEffect(() => {
    if (composerOpen && composerPostId && post) setForm(formFromPost(post));
  }, [composerOpen, composerPostId, post]);

  // Consume any pending AI suggestion pushed by the AI panel.
  useEffect(() => {
    if (!composerOpen || !pending) return;
    const suggestion = consume();
    if (!suggestion) return;
    setForm((f) => ({
      ...f,
      caption: suggestion.caption ?? f.caption,
      hashtags: suggestion.hashtags ? [...new Set([...f.hashtags, ...suggestion.hashtags])] : f.hashtags,
      title: suggestion.title ?? f.title,
    }));
  }, [pending, composerOpen, consume]);

  // Keep the AI panel's context pre-filled with what's being composed.
  useEffect(() => {
    if (!composerOpen) return;
    setAiContext({ brief: form.title || form.caption.slice(0, 160), platforms: form.targets.map((t) => t.platform), caption: form.caption });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerOpen, form.title, form.caption, form.targets]);

  // Keep the preview tab pointed at a selected platform.
  useEffect(() => {
    if (form.targets.length === 0) { setActivePlatform(null); return; }
    if (!form.targets.some((t) => t.platform === activePlatform)) setActivePlatform(form.targets[0]!.platform);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.targets]);

  const mediaMap = useMemo(() => new Map((media ?? []).map((m) => [m.id, m])), [media]);
  const resolveMedia = (ids: string[]): MediaAsset[] => ids.map((id) => mediaMap.get(id)).filter((m): m is MediaAsset => !!m);
  const selectedMedia = resolveMedia(form.mediaIds);

  const scheduledIso = computeScheduledIso(form.scheduledDate, form.scheduledMinutes);
  const issues = useMemo(
    () => validatePost({ title: form.title, caption: form.caption, hashtags: form.hashtags, mediaIds: form.mediaIds, targets: form.targets, scheduledAt: form.mode === "schedule" ? scheduledIso : null }, media ?? []),
    [form, media, scheduledIso],
  );
  const blocking = hasErrors(issues);

  const tightestTarget = form.targets.reduce<PostTarget | null>((min, t) => (!min || PLATFORM_SPECS[t.platform].captionMaxLength < PLATFORM_SPECS[min.platform].captionMaxLength ? t : min), null);
  const tightestLimit = tightestTarget ? PLATFORM_SPECS[tightestTarget.platform].captionMaxLength : null;
  const composedForCounter = tightestTarget ? effectiveCaption(form, tightestTarget) : composeCaption(form.caption, form.hashtags);
  const overLimit = tightestLimit != null && composedForCounter.length > tightestLimit;

  function addTarget(connection: PlatformConnection) {
    const spec = PLATFORM_SPECS[connection.platform];
    const newTarget: PostTarget = { platform: connection.platform, connectionId: connection.id, format: spec.defaultFormat, mediaIds: [], caption: null, title: null, hashtags: null };
    setForm((f) => ({ ...f, targets: [...f.targets, newTarget] }));
  }
  function removeTarget(platform: Platform) {
    setForm((f) => ({ ...f, targets: f.targets.filter((t) => t.platform !== platform) }));
  }
  function updateTarget(platform: Platform, patch: Partial<PostTarget>) {
    setForm((f) => ({ ...f, targets: f.targets.map((t) => (t.platform === platform ? { ...t, ...patch } : t)) }));
  }
  function toggleCustomize(platform: Platform) {
    setExpandedCustomize((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform); else next.add(platform);
      return next;
    });
  }

  function commitHashtag() {
    const cleaned = hashtagDraft.replace(/^#/, "").trim();
    if (cleaned) setForm((f) => ({ ...f, hashtags: f.hashtags.includes(cleaned) ? f.hashtags : [...f.hashtags, cleaned] }));
    setHashtagDraft("");
  }
  function removeHashtag(tag: string) {
    setForm((f) => ({ ...f, hashtags: f.hashtags.filter((h) => h !== tag) }));
  }
  function extractFromCaption() {
    const found = extractHashtags(form.caption);
    setForm((f) => ({ ...f, hashtags: [...new Set([...f.hashtags, ...found])] }));
  }

  function uploadFiles(files: FileList | File[]) {
    Array.from(files).forEach((file) => {
      upload.mutate({ file }, {
        onSuccess: (asset) => setForm((f) => ({ ...f, mediaIds: [...f.mediaIds, asset.id] })),
        onError: (err) => toast.error(`Upload failed for ${file.name}`, { description: (err as Error).message }),
      });
    });
  }

  function handleExport(result: ImageEditorExportResult) {
    if (!editingAsset) return;
    const base = editingAsset.filename.replace(/\.[^.]+$/, "");
    exportDataUrl.mutate(
      { dataUrl: result.dataUrl, filename: `${base}-${result.format}.jpg`, sourceAssetId: editingAsset.id, format: result.format, tags: [result.format] },
      {
        onSuccess: (asset) => {
          setForm((f) => ({
            ...f,
            mediaIds: f.mediaIds.includes(asset.id) ? f.mediaIds : [...f.mediaIds, asset.id],
            targets: f.targets.map((t) => (t.format === result.format ? { ...t, mediaIds: t.mediaIds.includes(asset.id) ? t.mediaIds : [...t.mediaIds, asset.id] } : t)),
          }));
          toast.success("Cropped export saved");
        },
        onError: (err) => toast.error("Export failed", { description: (err as Error).message }),
      },
    );
    setEditingAsset(null);
  }

  function buildInput(overrides: Partial<PostInput> = {}): PostInput {
    return {
      title: form.title,
      caption: form.caption,
      hashtags: form.hashtags,
      mediaIds: form.mediaIds,
      targets: form.targets,
      status: form.requiresApproval ? "needs_approval" : undefined,
      scheduledAt: form.mode === "schedule" ? scheduledIso : null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      labels: form.labels,
      notes: form.notes,
      ...overrides,
    };
  }

  async function ensureSaved(input: PostInput): Promise<string> {
    if (savedId) {
      const updated = await update.mutateAsync({ id: savedId, input });
      return updated.id;
    }
    const created = await create.mutateAsync(input);
    setSavedId(created.id);
    return created.id;
  }

  async function handleSaveDraft() {
    try {
      await ensureSaved(buildInput());
      toast.success("Draft saved");
      closeComposer();
    } catch (err) {
      toast.error("Couldn't save draft", { description: (err as Error).message });
    }
  }

  async function handleSchedule() {
    try {
      const id = await ensureSaved(buildInput({ scheduledAt: scheduledIso }));
      await schedule.mutateAsync({ id, scheduledAt: scheduledIso });
      toast.success("Post scheduled");
      closeComposer();
    } catch (err) {
      toast.error("Couldn't schedule post", { description: (err as Error).message });
    }
  }

  async function handlePublish() {
    if (!window.confirm("Publish this post now?")) return;
    try {
      const id = await ensureSaved(buildInput());
      const res = await publish.mutateAsync(id);
      const links = res.jobs.filter((j) => j.externalUrl);
      toast.success("Publishing started", {
        description: links.length > 0 ? links.map((j) => `${j.platform}: ${j.externalUrl}`).join("\n") : "Check Jobs for status.",
      });
      closeComposer();
    } catch (err) {
      toast.error("Publish failed", { description: (err as Error).message });
    }
  }

  async function handleDelete() {
    if (!savedId) return;
    if (!window.confirm("Delete this post? This cannot be undone.")) return;
    try {
      await remove.mutateAsync(savedId);
      toast.success("Post deleted");
      closeComposer();
    } catch (err) {
      toast.error("Couldn't delete post", { description: (err as Error).message });
    }
  }

  const enabledConnections = (connections ?? []).filter((c) => c.enabled);
  const activeTarget = form.targets.find((t) => t.platform === activePlatform) ?? null;
  const activeConnection = connections?.find((c) => c.platform === activePlatform);

  const allowedEditFormats = form.targets.length ? commonFormats(form.targets.map((t) => t.platform)) : undefined;
  const editorInitialFormat: PostFormat = form.targets[0]?.format ?? "square";

  return (
    <Drawer open={composerOpen} onClose={closeComposer} title={composerPostId ? "Edit post" : "New post"} width="max-w-4xl"
      footer={
        <div className="flex w-full items-center justify-between">
          <div>
            {savedId && (
              <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={handleDelete}>Delete</Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleSaveDraft} loading={create.isPending || update.isPending}>Save draft</Button>
            <Button variant="secondary" onClick={handleSchedule} disabled={blocking} loading={schedule.isPending}>Schedule</Button>
            <Button variant="primary" onClick={handlePublish} disabled={blocking} loading={publish.isPending}>Publish now</Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] divide-y lg:divide-y-0 lg:divide-x divide-ink-100">
        {/* Editor pane */}
        <div className="space-y-5 p-5">
          <Field label="Title" hint="Required for YouTube">
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Give this post a title" />
          </Field>

          <Field label="Caption">
            <Textarea value={form.caption} onChange={(e) => setForm((f) => ({ ...f, caption: e.target.value }))} placeholder="Write your caption…" rows={5} />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span data-testid="caption-counter" className={cn(overLimit ? "text-red-600 font-semibold" : "text-ink-400")}>
                {composedForCounter.length}/{tightestLimit ?? "∞"}
              </span>
              <button type="button" className="link" onClick={extractFromCaption}>Extract hashtags from caption</button>
            </div>
          </Field>

          <Field label="Hashtags">
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-ink-200 p-2">
              {form.hashtags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                  #{tag}
                  <button type="button" aria-label={`Remove #${tag}`} onClick={() => removeHashtag(tag)}><X className="h-3 w-3" /></button>
                </span>
              ))}
              <input
                className="min-w-[100px] flex-1 border-none bg-transparent text-sm outline-none"
                placeholder="#hashtag"
                value={hashtagDraft}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.endsWith(",")) { setHashtagDraft(v.slice(0, -1)); commitHashtag(); } else setHashtagDraft(v);
                }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitHashtag(); } }}
                aria-label="Add hashtag"
              />
            </div>
          </Field>

          <Field label="Labels" hint="Comma separated, for your own organisation">
            <Input value={form.labels.join(", ")} onChange={(e) => setForm((f) => ({ ...f, labels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))} />
          </Field>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-900">Targets</h3>
            <div className="space-y-2">
              {enabledConnections.length === 0 && <p className="text-xs text-ink-500">No enabled connections yet. Check Social Profiles.</p>}
              {enabledConnections.map((connection) => {
                const target = form.targets.find((t) => t.platform === connection.platform);
                const included = !!target;
                const spec = PLATFORM_SPECS[connection.platform];
                const expanded = expandedCustomize.has(connection.platform);
                return (
                  <div key={connection.id} className="rounded-lg border border-ink-200 p-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={() => (included ? removeTarget(connection.platform) : addTarget(connection))}
                        aria-label={`Include ${spec.name}`}
                      />
                      <PlatformIcon platform={connection.platform} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-900">{connection.displayName || spec.name}</p>
                        <p className="truncate text-xs text-ink-500">{connection.status === "connected" ? connection.handle : "Not connected"}</p>
                      </div>
                      {included && (
                        <Select
                          aria-label={`${spec.name} format`}
                          value={target!.format}
                          onChange={(e) => updateTarget(connection.platform, { format: e.target.value as PostFormat })}
                          className="w-40"
                        >
                          {spec.formats.map((f) => <option key={f} value={f}>{FORMAT_SPECS[f].label}</option>)}
                        </Select>
                      )}
                    </div>
                    {included && (
                      <div className="mt-2 pl-11">
                        <button type="button" className="link text-xs" onClick={() => toggleCustomize(connection.platform)}>
                          {expanded ? "Hide customization" : "Customize caption"}
                        </button>
                        {expanded && (
                          <div className="mt-2 space-y-2">
                            {connection.platform === "youtube" && (
                              <Input placeholder="Override title" value={target!.title ?? ""} onChange={(e) => updateTarget(connection.platform, { title: e.target.value || null })} />
                            )}
                            <Textarea placeholder="Override caption" value={target!.caption ?? ""} onChange={(e) => updateTarget(connection.platform, { caption: e.target.value || null })} rows={3} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-900">Media</h3>
              <div className="flex gap-2">
                <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ""; }} />
                <Button variant="outline" size="xs" icon={<UploadCloud className="h-3.5 w-3.5" />} onClick={() => fileInputRef.current?.click()}>Upload</Button>
                <Button variant="outline" size="xs" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setPickerOpen(true)}>Add from library</Button>
              </div>
            </div>
            {selectedMedia.length === 0 ? (
              <p className="text-xs text-ink-500">No media attached yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {selectedMedia.map((asset) => (
                  <div key={asset.id} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-ink-200">
                    {asset.kind === "image" ? (
                      <img src={asset.thumbnailUrl ?? asset.url} alt={asset.filename} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-ink-100 text-[10px] text-ink-500">video</div>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${asset.filename}`}
                      onClick={() => setForm((f) => ({ ...f, mediaIds: f.mediaIds.filter((id) => id !== asset.id) }))}
                      className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    {asset.kind === "image" && (
                      <button
                        type="button"
                        aria-label={`Edit ${asset.filename}`}
                        onClick={() => setEditingAsset(asset)}
                        className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 group-hover:opacity-100"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-900">Schedule</h3>
            <SegmentedTabs
              items={[{ id: "draft", label: "Save as draft" }, { id: "schedule", label: "Schedule" }]}
              value={form.mode}
              onChange={(v) => setForm((f) => ({ ...f, mode: v as "draft" | "schedule" }))}
              className="mb-3"
            />
            {form.mode === "schedule" && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Input type="date" value={form.scheduledDate} onChange={(e) => setForm((f) => ({ ...f, scheduledDate: e.target.value }))} className="w-40" />
                  <TimeScroller value={form.scheduledMinutes} onChange={(minutes) => setForm((f) => ({ ...f, scheduledMinutes: minutes }))} minuteStep={5} />
                </div>
                <p className="text-xs text-ink-500">
                  Posting at {formatMinutes(form.scheduledMinutes)} ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                </p>
              </div>
            )}
            <label className="mt-3 flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" checked={form.requiresApproval} onChange={(e) => setForm((f) => ({ ...f, requiresApproval: e.target.checked }))} />
              Requires approval
            </label>
          </div>

          {issues.length > 0 && (
            <div className="space-y-2 rounded-lg border border-ink-200 p-3">
              <h3 className="text-sm font-semibold text-ink-900">Validation</h3>
              {issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {issue.platform ? <PlatformIcon platform={issue.platform} size={20} /> : <span className="h-5 w-5" />}
                  <span className={issue.level === "error" ? "text-red-600" : "text-amber-600"}>{issue.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview pane */}
        <div className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-900">Preview</h3>
            <Sparkles className="h-4 w-4 text-brand-400" />
          </div>
          {form.targets.length === 0 ? (
            <p className="text-xs text-ink-500">Select at least one platform to see a live preview.</p>
          ) : (
            <>
              <SegmentedTabs
                items={form.targets.map((t) => ({ id: t.platform, label: PLATFORM_SPECS[t.platform].name }))}
                value={activePlatform ?? form.targets[0]!.platform}
                onChange={(v) => setActivePlatform(v as Platform)}
              />
              {activeTarget && (
                <PlatformPreview
                  platform={activeTarget.platform}
                  format={activeTarget.format}
                  title={activeTarget.title ?? form.title}
                  caption={effectiveCaption(form, activeTarget)}
                  media={resolveMedia(activeTarget.mediaIds.length ? activeTarget.mediaIds : form.mediaIds)}
                  displayName={activeConnection?.displayName}
                  handle={activeConnection?.handle}
                />
              )}
            </>
          )}
        </div>
      </div>

      {pickerOpen && (
        <MediaPicker
          open={pickerOpen}
          initialSelected={form.mediaIds}
          onClose={() => setPickerOpen(false)}
          onConfirm={(ids) => setForm((f) => ({ ...f, mediaIds: [...new Set([...f.mediaIds, ...ids])] }))}
        />
      )}

      {editingAsset && (
        <ImageEditor
          asset={editingAsset}
          initialFormat={editingAsset.format ?? editorInitialFormat}
          allowedFormats={allowedEditFormats}
          onExport={handleExport}
          onClose={() => setEditingAsset(null)}
        />
      )}
    </Drawer>
  );
}
