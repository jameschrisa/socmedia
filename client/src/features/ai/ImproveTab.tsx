import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PLATFORM_SPECS, PLATFORMS, type AiTone, type ImproveRequestInput, type Platform } from "@socmedia/shared";
import { Badge, Button, Field, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useAppStore } from "@/store/appStore";
import { useAiBridge } from "./aiBridge";
import { useAiStore, type ImproveResult } from "./aiStore";
import { ApiErrorNotice, RecentList, ResultsPlaceholder, ThinkingSkeleton } from "./aiShared";
import { cn } from "@/lib/utils";

const PRESETS: { label: string; instruction: string }[] = [
  { label: "Shorter", instruction: "Make it noticeably shorter" },
  { label: "Stronger hook", instruction: "Give it a stronger, scroll-stopping hook" },
  { label: "Add a CTA", instruction: "Add a clear call to action" },
  { label: "More casual", instruction: "Make the tone more casual" },
  { label: "More professional", instruction: "Make the tone more professional" },
  { label: "Fix grammar", instruction: "Fix grammar and spelling" },
];

const TONES: AiTone[] = ["professional", "casual", "playful", "inspirational", "educational", "bold"];

export function ImproveTab() {
  const context = useAiBridge((s) => s.context);
  const [caption, setCaption] = useState("");
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [instruction, setInstruction] = useState("Make it more engaging");
  const [tone, setTone] = useState<AiTone | "">("");

  useEffect(() => {
    const seed = useAiStore.getState().improveSeed;
    if (seed) {
      setCaption(seed.caption);
      if (seed.platform) setPlatform(seed.platform);
      useAiStore.getState().setImproveSeed(null);
    } else {
      setCaption((prev) => prev || context.caption || "");
      if (context.platforms[0]) setPlatform(context.platforms[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const result = useAiStore((s) => s.improveResult);

  const mutation = useMutation({
    mutationFn: (input: ImproveRequestInput) => api.ai.improve(input),
    onSuccess: (data, variables) => {
      const entry: ImproveResult = { before: variables.caption, caption: data.caption, hashtags: data.hashtags, model: data.model, mock: data.mock, platform: variables.platform };
      useAiStore.getState().setImproveResult(entry);
      useAiStore.getState().setLastMock(data.mock);
      useAiStore.getState().addHistory({ tab: "improve", mock: data.mock, label: instruction.slice(0, 60) || "Improve" });
    },
  });

  function generate() {
    if (!caption.trim()) return;
    mutation.mutate({ caption, platform, instruction: instruction.trim() || "Make it more engaging", tone: tone || undefined });
  }

  function useThis() {
    if (!result) return;
    useAiBridge.getState().push({ kind: "caption", caption: result.caption, hashtags: result.hashtags, platform: result.platform });
    if (!useAppStore.getState().composerOpen) useAppStore.getState().openComposer(null);
    toast.success("Sent to composer");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="space-y-4">
        <Field label="Caption" htmlFor="ai-improve-caption">
          <Textarea id="ai-improve-caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Paste the caption you want to improve" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Platform" htmlFor="ai-improve-platform">
            <Select id="ai-improve-platform" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_SPECS[p].name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tone" htmlFor="ai-improve-tone" hint="Optional">
            <Select id="ai-improve-tone" value={tone} onChange={(e) => setTone(e.target.value as AiTone | "")}>
              <option value="">No change</option>
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t[0]!.toUpperCase() + t.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Instruction" htmlFor="ai-improve-instruction">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setInstruction(preset.instruction)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  instruction === preset.instruction ? "border-brand-300 bg-brand-50 text-brand-700" : "border-ink-200 bg-glass text-ink-600 hover:bg-ink-50",
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <input id="ai-improve-instruction" className="input" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Tell the AI what to change" />
        </Field>

        <Button icon={<Sparkles className="h-4 w-4" />} onClick={generate} loading={mutation.isPending} disabled={!caption.trim()}>
          Generate
        </Button>
      </div>

      <div className="space-y-4">
        {mutation.isPending && <ThinkingSkeleton count={1} />}
        {mutation.isError && <ApiErrorNotice error={mutation.error} onRetry={generate} />}

        {!mutation.isPending && result && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="label">Before</p>
                <div className="card whitespace-pre-wrap p-3 text-sm text-ink-500">{result.before}</div>
              </div>
              <div className="space-y-1.5">
                <p className="label">After</p>
                <div className="card whitespace-pre-wrap border-brand-200 bg-brand-50 p-3 text-sm text-ink-900">{result.caption}</div>
              </div>
            </div>
            {result.hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {result.hashtags.map((h) => (
                  <Badge key={h} tone="neutral" className="normal-case">
                    {h}
                  </Badge>
                ))}
              </div>
            )}
            <Button size="sm" variant="primary" onClick={useThis}>
              Use this
            </Button>
          </div>
        )}

        {!mutation.isPending && !mutation.isError && !result && <ResultsPlaceholder text="The improved caption will appear here." />}

        <RecentList tab="improve" />
      </div>
    </div>
  );
}
