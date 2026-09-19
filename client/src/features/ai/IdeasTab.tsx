import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Minus, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { FORMAT_SPECS, PLATFORMS, type ContentIdea, type IdeaRequest, type Platform } from "@socmedia/shared";
import { Badge, Button, Field, PlatformIcon, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useAppStore } from "@/store/appStore";
import { useAiBridge } from "./aiBridge";
import { useAiStore } from "./aiStore";
import { ApiErrorNotice, PlatformChips, RecentList, ThinkingSkeleton } from "./aiShared";
import { buildBriefFromIdea } from "./aiUtils";

export function IdeasTab() {
  const context = useAiBridge((s) => s.context);
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [count, setCount] = useState(6);

  useEffect(() => {
    setTopic((prev) => prev || context.brief || "");
    setPlatforms(context.platforms.length > 0 ? context.platforms : [...PLATFORMS]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const result = useAiStore((s) => s.ideasResult);
  const setActiveTab = useAiStore((s) => s.setActiveTab);

  const mutation = useMutation({
    mutationFn: (input: IdeaRequest) => api.ai.ideas(input),
    onSuccess: (data) => {
      useAiStore.getState().setIdeasResult(data);
      useAiStore.getState().setLastMock(data.mock);
      useAiStore.getState().addHistory({ tab: "ideas", mock: data.mock, label: topic.slice(0, 60) || "Ideas" });
    },
  });

  function generate() {
    if (!topic.trim() || platforms.length === 0) return;
    mutation.mutate({ topic, platforms, audience: audience.trim() || undefined, count });
  }

  function draftThis(idea: ContentIdea) {
    useAiBridge.getState().push({
      kind: "idea",
      title: idea.title,
      caption: `${idea.hook}\n\n${idea.outline.join("\n")}`,
      platform: idea.platform,
      idea,
    });
    if (!useAppStore.getState().composerOpen) useAppStore.getState().openComposer(null);
    toast.success("Sent to composer");
  }

  function writeCaptions(idea: ContentIdea) {
    useAiStore.getState().setCaptionsBriefSeed(buildBriefFromIdea(idea));
    setActiveTab("captions");
  }

  return (
    <div className="space-y-4">
      <Field label="Topic" htmlFor="ai-idea-topic">
        <Textarea id="ai-idea-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Behind-the-scenes of our product roadmap" />
      </Field>

      <Field label="Audience" htmlFor="ai-idea-audience" hint="Optional. Who is this for?">
        <input id="ai-idea-audience" className="input" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. small business owners" />
      </Field>

      <Field label="Platforms">
        <PlatformChips value={platforms} onChange={setPlatforms} />
      </Field>

      <div className="flex items-center gap-2 text-sm text-ink-700">
        <span>Ideas</span>
        <div className="flex items-center rounded-lg border border-ink-200">
          <button type="button" aria-label="Fewer ideas" className="px-2 py-1 text-ink-500 hover:text-ink-900" onClick={() => setCount((c) => Math.max(3, c - 1))}>
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-6 text-center font-semibold">{count}</span>
          <button type="button" aria-label="More ideas" className="px-2 py-1 text-ink-500 hover:text-ink-900" onClick={() => setCount((c) => Math.min(12, c + 1))}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <Button icon={<Sparkles className="h-4 w-4" />} onClick={generate} loading={mutation.isPending} disabled={!topic.trim() || platforms.length === 0}>
        Generate
      </Button>

      {mutation.isPending && <ThinkingSkeleton count={2} />}
      {mutation.isError && <ApiErrorNotice error={mutation.error} onRetry={generate} />}

      {!mutation.isPending && result && result.ideas.length > 0 && (
        <div className="space-y-3">
          {result.ideas.map((idea, i) => (
            <IdeaCard key={i} idea={idea} onDraft={() => draftThis(idea)} onWriteCaptions={() => writeCaptions(idea)} />
          ))}
        </div>
      )}

      <RecentList tab="ideas" />
    </div>
  );
}

function IdeaCard({ idea, onDraft, onWriteCaptions }: { idea: ContentIdea; onDraft: () => void; onWriteCaptions: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="card space-y-2.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PlatformIcon platform={idea.platform} size={20} />
          <span className="text-sm font-bold text-ink-900">{idea.title}</span>
        </div>
        <Badge tone="info" className="normal-case">
          {FORMAT_SPECS[idea.format].label}
        </Badge>
      </div>
      <p className="text-sm text-ink-700">{idea.hook}</p>

      <button type="button" onClick={() => setExpanded((v) => !v)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {expanded ? "Hide outline" : "Show outline"}
      </button>
      {expanded && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">
          {idea.outline.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}

      <p className="text-xs text-ink-500">
        <span className="font-semibold text-ink-600">Why it works: </span>
        {idea.whyItWorks}
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="xs" variant="primary" onClick={onDraft}>
          Draft this
        </Button>
        <Button size="xs" variant="outline" onClick={onWriteCaptions}>
          Write captions
        </Button>
      </div>
    </div>
  );
}
