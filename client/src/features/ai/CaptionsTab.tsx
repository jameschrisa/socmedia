import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Minus, Plus, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { PLATFORM_SPECS, PLATFORMS, type AiTone, type CaptionRequest, type CaptionVariant, type Platform } from "@socmedia/shared";
import { Badge, Button, Field, PlatformIcon, Select, Textarea, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { useAppStore } from "@/store/appStore";
import { useCurrentOrgId } from "@/hooks/useOrg";
import { useAiBridge } from "./aiBridge";
import { useAiStore } from "./aiStore";
import { ApiErrorNotice, PlatformChips, RecentList, ResultsPlaceholder, ThinkingSkeleton } from "./aiShared";
import { charStatus, toneLabel } from "./aiUtils";

const TONES: AiTone[] = ["professional", "casual", "playful", "inspirational", "educational", "bold"];

export function CaptionsTab() {
  const context = useAiBridge((s) => s.context);
  const orgId = useCurrentOrgId();

  const [brief, setBrief] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [tone, setTone] = useState<AiTone>("professional");
  const [brandVoice, setBrandVoice] = useState("");
  const [includeHashtags, setIncludeHashtags] = useState(true);
  const [includeCta, setIncludeCta] = useState(true);
  const [variants, setVariants] = useState(2);
  const [language, setLanguage] = useState("English");

  // Pre-fill from the composer's shared context, or from a hand-off seeded by the Ideas tab.
  useEffect(() => {
    const seed = useAiStore.getState().captionsBriefSeed;
    if (seed) {
      setBrief(seed);
      useAiStore.getState().setCaptionsBriefSeed(null);
    } else {
      setBrief((prev) => prev || context.brief || context.caption || "");
    }
    setPlatforms(context.platforms.length > 0 ? context.platforms : [...PLATFORMS]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Brand voice is remembered per org.
  useEffect(() => {
    if (!orgId) return;
    const saved = localStorage.getItem(`pulse-brand-voice-${orgId}`);
    if (saved) setBrandVoice(saved);
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    localStorage.setItem(`pulse-brand-voice-${orgId}`, brandVoice);
  }, [orgId, brandVoice]);

  const result = useAiStore((s) => s.captionsResult);
  const setActiveTab = useAiStore((s) => s.setActiveTab);

  const mutation = useMutation({
    mutationFn: (input: CaptionRequest) => api.ai.captions(input),
    onSuccess: (data) => {
      useAiStore.getState().setCaptionsResult(data);
      useAiStore.getState().setLastMock(data.mock);
      useAiStore.getState().addHistory({ tab: "captions", mock: data.mock, label: brief.slice(0, 60) || "Captions" });
    },
  });

  function generate() {
    if (!brief.trim() || platforms.length === 0) return;
    mutation.mutate({
      brief,
      platforms,
      tone,
      brandVoice: brandVoice.trim() || undefined,
      includeHashtags,
      includeCta,
      language,
      variants,
    });
  }

  const grouped = useMemo(() => {
    if (!result) return [];
    const map = new Map<Platform, CaptionVariant[]>();
    for (const v of result.variants) map.set(v.platform, [...(map.get(v.platform) ?? []), v]);
    return Array.from(map.entries());
  }, [result]);

  function useInComposer(v: CaptionVariant) {
    useAiBridge.getState().push({ kind: "caption", caption: v.caption, hashtags: v.hashtags, title: v.title, platform: v.platform });
    if (!useAppStore.getState().composerOpen) useAppStore.getState().openComposer(null);
    toast.success("Sent to composer");
  }

  function copyCaption(v: CaptionVariant) {
    navigator.clipboard?.writeText(v.caption).catch(() => {});
    toast.success("Caption copied");
  }

  function improveThis(v: CaptionVariant) {
    useAiStore.getState().setImproveSeed({ caption: v.caption, platform: v.platform });
    setActiveTab("improve");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="space-y-4">
        <Field label="Brief" htmlFor="ai-caption-brief" hint="What's the post about? Give the AI something to work with.">
          <Textarea
            id="ai-caption-brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="e.g. Announcing our new fall product line, playful and exciting"
          />
        </Field>

        <Field label="Platforms">
          <PlatformChips value={platforms} onChange={setPlatforms} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tone" htmlFor="ai-caption-tone">
            <Select id="ai-caption-tone" value={tone} onChange={(e) => setTone(e.target.value as AiTone)}>
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {toneLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Language" htmlFor="ai-caption-language">
            <input
              id="ai-caption-language"
              className="input"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Brand voice" htmlFor="ai-caption-brand-voice" hint="Saved for this workspace and reused next time.">
          <Textarea
            id="ai-caption-brand-voice"
            value={brandVoice}
            onChange={(e) => setBrandVoice(e.target.value)}
            placeholder="e.g. Warm, confident, a little cheeky. Avoid corporate jargon."
            className="min-h-[64px]"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-5">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <Toggle checked={includeHashtags} onChange={setIncludeHashtags} label="Include hashtags" size="sm" />
            Hashtags
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <Toggle checked={includeCta} onChange={setIncludeCta} label="Include CTA" size="sm" />
            Call to action
          </label>
          <div className="flex items-center gap-2 text-sm text-ink-700">
            <span>Variants</span>
            <div className="flex items-center rounded-lg border border-ink-200">
              <button type="button" aria-label="Fewer variants" className="px-2 py-1 text-ink-500 hover:text-ink-900" onClick={() => setVariants((v) => Math.max(1, v - 1))}>
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-6 text-center font-semibold">{variants}</span>
              <button type="button" aria-label="More variants" className="px-2 py-1 text-ink-500 hover:text-ink-900" onClick={() => setVariants((v) => Math.min(5, v + 1))}>
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <Button icon={<Sparkles className="h-4 w-4" />} onClick={generate} loading={mutation.isPending} disabled={!brief.trim() || platforms.length === 0}>
          Generate
        </Button>
      </div>

      <div className="space-y-4">
        {mutation.isPending && <ThinkingSkeleton count={Math.min(variants, 3)} />}
        {mutation.isError && <ApiErrorNotice error={mutation.error} onRetry={generate} />}

        {!mutation.isPending && grouped.length > 0 && (
          <div className="space-y-4">
            {grouped.map(([platform, vs]) => (
              <div key={platform} className="space-y-2">
                {vs.map((v, i) => (
                  <CaptionCard key={`${platform}-${i}`} variant={v} onUse={() => useInComposer(v)} onCopy={() => copyCaption(v)} onImprove={() => improveThis(v)} onRegenerate={generate} />
                ))}
              </div>
            ))}
          </div>
        )}

        {!mutation.isPending && !mutation.isError && grouped.length === 0 && (
          <ResultsPlaceholder text="Generated captions will appear here." />
        )}

        <RecentList tab="captions" />
      </div>
    </div>
  );
}

function CaptionCard({ variant, onUse, onCopy, onImprove, onRegenerate }: { variant: CaptionVariant; onUse: () => void; onCopy: () => void; onImprove: () => void; onRegenerate: () => void }) {
  const limit = PLATFORM_SPECS[variant.platform].captionMaxLength;
  const status = charStatus(variant.charCount, limit);
  const colorClass = status === "over" ? "text-red-600" : status === "warn" ? "text-amber-600" : "text-green-600";

  return (
    <div className="card space-y-2.5 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PlatformIcon platform={variant.platform} size={20} />
          <span className="text-sm font-semibold text-ink-900">{PLATFORM_SPECS[variant.platform].name}</span>
        </div>
        <span className={`text-xs font-medium ${colorClass}`}>
          {variant.charCount} / {limit}
        </span>
      </div>

      {variant.title && <p className="text-sm font-semibold text-ink-900">{variant.title}</p>}
      <p className="text-sm font-bold text-ink-900">{variant.hook}</p>
      <p className="whitespace-pre-wrap text-sm text-ink-700">{variant.caption}</p>

      {variant.hashtags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {variant.hashtags.map((h) => (
            <Badge key={h} tone="neutral" className="normal-case">
              {h}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="xs" variant="primary" onClick={onUse}>
          Use in composer
        </Button>
        <Button size="xs" variant="outline" onClick={onCopy}>
          Copy
        </Button>
        <Button size="xs" variant="outline" icon={<Wand2 className="h-3.5 w-3.5" />} onClick={onImprove}>
          Improve…
        </Button>
        <Button size="xs" variant="ghost" onClick={onRegenerate}>
          Regenerate
        </Button>
      </div>
    </div>
  );
}
