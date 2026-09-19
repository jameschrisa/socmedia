import { Sparkles } from "lucide-react";
import { Badge, Drawer, SegmentedTabs, type TabItem } from "@/components/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAppStore } from "@/store/appStore";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { BestTimesWidget } from "./BestTimesWidget";
import { CaptionsTab } from "./CaptionsTab";
import { HashtagsTab } from "./HashtagsTab";
import { IdeasTab } from "./IdeasTab";
import { ImproveTab } from "./ImproveTab";
import { useAiStore, type AiTabId } from "./aiStore";

const TABS: TabItem<AiTabId>[] = [
  { id: "captions", label: "Captions" },
  { id: "ideas", label: "Ideas" },
  { id: "hashtags", label: "Hashtags" },
  { id: "improve", label: "Improve" },
];

const PROVIDER_LABEL = { anthropic: "Powered by Claude", moonshot: "Powered by Kimi", mock: "Offline mock" } as const;

function AiPanelTitle({ mock }: { mock: boolean }) {
  const health = useQuery({ queryKey: qk.health, queryFn: api.health, staleTime: 60_000 });
  const provider = health.data?.ai.provider ?? "anthropic";
  const model = health.data?.ai.model;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Sparkles className="h-4 w-4 text-brand-500" aria-hidden />
      AI Assistant
      <Link to="/settings" title={model ? `Model: ${model} · change in Settings` : "Change in Settings"} onClick={() => useAppStore.getState().setAiPanelOpen(false)}>
        <Badge tone={provider === "mock" ? "warning" : "brand"}>{PROVIDER_LABEL[provider]}</Badge>
      </Link>
      {mock && provider !== "mock" && <Badge tone="warning">offline mock</Badge>}
    </span>
  );
}

/**
 * Global AI Assistant drawer. Rendered once in AppShell; stays invisible until
 * the user opens it via useAppStore's aiPanelOpen flag.
 */
export function AiPanel() {
  const open = useAppStore((s) => s.aiPanelOpen);
  const setOpen = useAppStore((s) => s.setAiPanelOpen);
  const activeTab = useAiStore((s) => s.activeTab);
  const setActiveTab = useAiStore((s) => s.setActiveTab);
  const lastMock = useAiStore((s) => s.lastMock);

  return (
    <Drawer open={open} onClose={() => setOpen(false)} title={<AiPanelTitle mock={lastMock} />} footer={<BestTimesWidget />}>
      <div className="space-y-4 p-4">
        <SegmentedTabs items={TABS} value={activeTab} onChange={setActiveTab} />
        {activeTab === "captions" && <CaptionsTab />}
        {activeTab === "ideas" && <IdeasTab />}
        {activeTab === "hashtags" && <HashtagsTab />}
        {activeTab === "improve" && <ImproveTab />}
      </div>
    </Drawer>
  );
}
