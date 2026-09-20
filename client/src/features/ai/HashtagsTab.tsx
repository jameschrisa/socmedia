import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Hash, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PLATFORM_SPECS, PLATFORMS, type Platform } from "@socmedia/shared";
import { Button, Field, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useAiBridge } from "./aiBridge";
import { useAiStore } from "./aiStore";
import { ApiErrorNotice, RecentList, ResultsPlaceholder, ThinkingSkeleton } from "./aiShared";
import { cn } from "@/lib/utils";

export function HashtagsTab() {
  const context = useAiBridge((s) => s.context);
  const [caption, setCaption] = useState("");
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [count, setCount] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setCaption((prev) => prev || context.caption || context.brief || "");
    if (context.platforms[0]) setPlatform(context.platforms[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const result = useAiStore((s) => s.hashtagsResult);

  const mutation = useMutation({
    mutationFn: (input: { caption: string; platform: Platform; count?: number }) => api.ai.hashtags(input),
    onSuccess: (data) => {
      useAiStore.getState().setHashtagsResult(data);
      useAiStore.getState().setLastMock(data.mock);
      useAiStore.getState().addHistory({ tab: "hashtags", mock: data.mock, label: caption.slice(0, 60) || "Hashtags" });
      setSelected(new Set(data.hashtags));
    },
  });

  function generate() {
    if (!caption.trim()) return;
    mutation.mutate({ caption, platform, count });
  }

  function toggle(tag: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  function addSelected() {
    if (selected.size === 0) return;
    useAiBridge.getState().push({ kind: "hashtags", hashtags: Array.from(selected) });
    toast.success("Hashtags sent to composer");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="space-y-4">
        <Field label="Caption" htmlFor="ai-hashtag-caption">
          <Textarea id="ai-hashtag-caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Paste your caption to get relevant hashtags" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Platform" htmlFor="ai-hashtag-platform">
            <Select id="ai-hashtag-platform" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_SPECS[p].name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Count" htmlFor="ai-hashtag-count">
            <input
              id="ai-hashtag-count"
              type="number"
              min={3}
              max={30}
              className="input"
              value={count}
              onChange={(e) => setCount(Math.max(3, Math.min(30, Number(e.target.value) || 3)))}
            />
          </Field>
        </div>

        <Button icon={<Sparkles className="h-4 w-4" />} onClick={generate} loading={mutation.isPending} disabled={!caption.trim()}>
          Generate
        </Button>
      </div>

      <div className="space-y-4">
        {mutation.isPending && <ThinkingSkeleton count={1} />}
        {mutation.isError && <ApiErrorNotice error={mutation.error} onRetry={generate} />}

        {!mutation.isPending && result && result.hashtags.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {result.hashtags.map((tag) => {
                const active = selected.has(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggle(tag)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      active ? "border-brand-300 bg-brand-50 text-brand-700" : "border-ink-200 bg-glass text-ink-500 hover:bg-ink-50",
                    )}
                  >
                    <Hash className="h-3 w-3" />
                    {tag.replace(/^#/, "")}
                  </button>
                );
              })}
            </div>
            <Button size="sm" variant="primary" onClick={addSelected} disabled={selected.size === 0}>
              Add selected to composer
            </Button>
          </div>
        )}

        {!mutation.isPending && !mutation.isError && (!result || result.hashtags.length === 0) && (
          <ResultsPlaceholder text="Generated hashtags will appear here." />
        )}

        <RecentList tab="hashtags" />
      </div>
    </div>
  );
}
