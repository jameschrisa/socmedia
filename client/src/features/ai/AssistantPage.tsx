import { useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, SegmentedTabs, type TabItem } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { BestTimesTab } from "./BestTimesTab";
import { CaptionsTab } from "./CaptionsTab";
import { HashtagsTab } from "./HashtagsTab";
import { IdeasTab } from "./IdeasTab";
import { ImproveTab } from "./ImproveTab";
import { useAiStore, type AiTabId } from "./aiStore";
import { ASSISTANT_TAB_FOR_HASH, ASSISTANT_TAB_HASH } from "./aiUtils";

const TABS: TabItem<AiTabId>[] = [
  { id: "captions", label: "Captions" },
  { id: "ideas", label: "Ideas" },
  { id: "hashtags", label: "Hashtags" },
  { id: "improve", label: "Improve" },
  { id: "bestTimes", label: "Best times" },
];

const PROVIDER_LABEL = { anthropic: "Powered by Claude", moonshot: "Powered by Kimi", mock: "Offline mock" } as const;

/** Provider/model badge, links to the AI providers section of Settings so the user can switch
 * between mock and live without hunting for it. */
function ProviderBadge() {
  const health = useQuery({ queryKey: qk.health, queryFn: api.health, staleTime: 60_000 });
  const provider = health.data?.ai.provider ?? "anthropic";
  const model = health.data?.ai.model;
  const lastMock = useAiStore((s) => s.lastMock);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Link to="/settings#ai-providers" title={model ? `Model: ${model} · change in Settings` : "Change in Settings"}>
        <Badge tone={provider === "mock" ? "warning" : "brand"}>{PROVIDER_LABEL[provider]}</Badge>
      </Link>
      {lastMock && provider !== "mock" && <Badge tone="warning">offline mock</Badge>}
    </span>
  );
}

/**
 * Which tab is showing, kept in sync with both the URL hash (so `/assistant#ideas` and back/forward
 * navigation work) and the aiStore's `activeTab` (so an in-tab hand-off, like "Improve…" on a
 * caption card, still switches tabs the way it did inside the old drawer).
 *
 * Both directions are handled by one effect (not two) so they can agree on which one "won" for a
 * given render: a `prevHash` ref tells us whether the hash itself just changed (a deep link or
 * back/forward navigation, which should drive the tab) or the tab changed some other way (a click
 * or a hand-off, which should drive the hash). Two independent effects would each act on the same
 * stale snapshot and fight each other into an infinite loop.
 */
function useAssistantTab(): AiTabId {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = useAiStore((s) => s.activeTab);
  const setActiveTab = useAiStore((s) => s.setActiveTab);
  const prevHash = useRef<string | undefined>(undefined);

  useEffect(() => {
    const hashChanged = location.hash !== prevHash.current;
    prevHash.current = location.hash;

    if (hashChanged) {
      const fromHash = ASSISTANT_TAB_FOR_HASH[location.hash];
      if (fromHash && fromHash !== activeTab) {
        setActiveTab(fromHash);
      } else if (!fromHash) {
        // No hash yet, or an unrecognized one: normalize the URL to match the current tab.
        navigate({ pathname: location.pathname, hash: ASSISTANT_TAB_HASH[activeTab] }, { replace: true });
      }
      return;
    }

    // The hash didn't change, so the tab must have: reflect it in the URL.
    const hash = ASSISTANT_TAB_HASH[activeTab];
    if (hash !== location.hash) navigate({ pathname: location.pathname, hash }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash, activeTab]);

  return activeTab;
}

/**
 * Full-page AI Assistant: generate captions, ideas and hashtags, improve a draft, and find the
 * best times to post. Replaces the old side drawer; "Use in composer" / "Draft this" / "Add
 * selected to composer" still hand off to the composer via aiBridge exactly as before, opening it
 * over this page.
 */
export function AssistantPage() {
  const tab = useAssistantTab();
  const setActiveTab = useAiStore((s) => s.setActiveTab);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">AI Assistant</h1>
          <p className="mt-1 text-sm text-ink-500">Generate captions, ideas and hashtags, improve a draft, and find the best times to post.</p>
        </div>
        <ProviderBadge />
      </div>

      <div data-testid="assistant-tabs">
        <SegmentedTabs<AiTabId> items={TABS} value={tab} onChange={setActiveTab} size="md" />
      </div>

      {tab === "captions" && <CaptionsTab />}
      {tab === "ideas" && <IdeasTab />}
      {tab === "hashtags" && <HashtagsTab />}
      {tab === "improve" && <ImproveTab />}
      {tab === "bestTimes" && <BestTimesTab />}
    </div>
  );
}
