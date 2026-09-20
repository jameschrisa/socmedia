import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, CalendarCheck2, Sparkles, HeartHandshake, ExternalLink, Search, Terminal, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PLATFORMS, PLATFORM_SPECS, type Platform } from "@socmedia/shared";
import { Button, Portal, useAnchorPosition } from "@/components/ui";
import { useAppStore } from "@/store/appStore";
import { useOpenConsole } from "@/features/console/useConsoleNav";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type PanelId = "docs" | "scheduler" | "approvals";

/** Support-facing search over the bundled platform developer docs, reachable outside the console too. */
function PlatformDocsSearch() {
  const [platform, setPlatform] = useState<Platform | "">("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const search = useQuery({
    queryKey: qk.docsSearch({ platform: platform || undefined, q: debouncedQ }),
    queryFn: () => api.docs.searchPlatforms({ platform: platform || undefined, q: debouncedQ, limit: 5 }),
    enabled: debouncedQ.length > 1,
  });
  const hits = search.data?.hits ?? [];

  return (
    <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--c-edge)" }}>
      <p className="text-xs font-semibold text-ink-700">Platform docs</p>
      <div className="mt-2 flex gap-1.5">
        <select
          aria-label="Filter docs by platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform | "")}
          className="input select-chevron !h-8 w-[6.5rem] shrink-0 !py-0 pr-6 text-xs"
        >
          <option value="">All</option>
          {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_SPECS[p].name}</option>)}
        </select>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" aria-hidden />
          <input
            type="search"
            aria-label="Search platform docs"
            data-testid="platform-docs-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search docs…"
            className="input !h-8 w-full !py-0 pl-7 text-xs"
          />
        </div>
      </div>
      <div className="mt-2 max-h-56 space-y-2.5 overflow-y-auto scrollbar-thin" data-testid="platform-docs-results">
        {search.isFetching && <p className="text-xs text-ink-500">Searching…</p>}
        {!search.isFetching && debouncedQ.length > 1 && hits.length === 0 && (
          <p className="text-xs text-ink-500">No matches in the platform docs. Try a shorter term{platform ? ", or set the platform back to All" : ""}.</p>
        )}
        {hits.map((hit, i) => (
          <div key={`${hit.file}-${hit.heading}-${i}`} className="text-xs" data-testid="platform-docs-hit">
            <div className="flex items-center gap-1.5">
              <span className="chip chip-inactive !px-1.5 !py-0 text-[10px] uppercase">{hit.platform}</span>
              <span className="min-w-0 truncate font-medium text-ink-800">{hit.heading}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-ink-500">{hit.excerpt}</p>
            {hit.sources[0] && (
              <a href={hit.sources[0]} target="_blank" rel="noreferrer" className="link mt-0.5 inline-flex items-center gap-1 text-[11px]">
                Source <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Collapsed help rail: a slim strip of icon buttons. Panels are hidden by default and
 * open in a popover beside the rail so they never take space from the page content.
 */
export function RightRail() {
  const setAiPanelOpen = useAppStore((s) => s.setAiPanelOpen);
  const openConsole = useOpenConsole();
  const [open, setOpen] = useState<PanelId | null>(null);
  const railRef = useRef<HTMLElement>(null);
  const PANEL_W = 288;
  const pos = useAnchorPosition(railRef, !!open, { side: "left", offset: 8, width: PANEL_W });
  const health = useQuery({ queryKey: qk.health, queryFn: api.health, staleTime: 60_000, enabled: open === "scheduler" });

  const toggle = (id: PanelId) => setOpen((cur) => (cur === id ? null : id));

  const items: { id: PanelId | "ai" | "console"; label: string; icon: React.ReactNode; tone: string; onClick: () => void }[] = [
    { id: "ai", label: "AI Assistant", icon: <Sparkles className="h-4 w-4" />, tone: "text-brand-600 bg-brand-50 hover:bg-brand-100", onClick: () => { setOpen(null); setAiPanelOpen(true); } },
    { id: "console", label: "Console", icon: <Terminal className="h-4 w-4" />, tone: "text-ink-600 bg-ink-50 hover:bg-ink-100", onClick: () => { setOpen(null); openConsole(); } },
    { id: "docs", label: "Documentation", icon: <BookOpen className="h-4 w-4" />, tone: "text-ink-600 bg-ink-50 hover:bg-ink-100", onClick: () => toggle("docs") },
    { id: "scheduler", label: "Scheduler status", icon: <CalendarCheck2 className="h-4 w-4" />, tone: "text-green-600 bg-green-50 hover:bg-green-100", onClick: () => toggle("scheduler") },
    { id: "approvals", label: "Approvals", icon: <HeartHandshake className="h-4 w-4" />, tone: "text-pink-600 bg-pink-50 hover:bg-pink-100", onClick: () => toggle("approvals") },
  ];

  return (
    <aside ref={railRef} className="relative hidden lg:flex shrink-0 flex-col gap-2 sticky top-[7.5rem]" aria-label="Help">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          title={item.label}
          aria-label={item.label}
          aria-expanded={item.id === "ai" || item.id === "console" ? undefined : open === item.id}
          onClick={item.onClick}
          data-testid={`rail-${item.id}`}
          className={cn("flex h-10 w-10 items-center justify-center border border-ink-200 bg-glass transition-colors", item.tone, item.id !== "ai" && item.id !== "console" && open === item.id && "ring-2 ring-brand-300")}
        >
          {item.icon}
        </button>
      ))}

      <Portal>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(null)} />
            <motion.div
              key={open}
              role="dialog"
              aria-label={items.find((i) => i.id === open)?.label}
              initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.15 }}
              style={{ position: "fixed", top: pos.top, left: pos.left, width: PANEL_W }}
              className="z-[100] card glass-menu p-5 shadow-pop"
            >
              <button onClick={() => setOpen(null)} aria-label="Close" className="absolute right-3 top-3 p-1 text-ink-400 hover:text-ink-700"><X className="h-4 w-4" /></button>
              {open === "docs" && (
                <>
                  <div className="flex h-9 w-9 items-center justify-center bg-brand-50 text-brand-600"><BookOpen className="h-4 w-4" /></div>
                  <h3 className="mt-3 text-sm font-semibold">Documentation</h3>
                  <p className="mt-1 text-sm text-ink-500">How to obtain API credentials for each network and switch from sandbox to live publishing. See <code className="bg-ink-100 px-1 text-xs">server/README.md</code>.</p>
                  <a className="link mt-3 inline-flex items-center gap-1 text-sm" href="https://github.com" target="_blank" rel="noreferrer">Open docs <ExternalLink className="h-3.5 w-3.5" /></a>
                  <PlatformDocsSearch />
                </>
              )}
              {open === "scheduler" && (
                <>
                  <div className="flex h-9 w-9 items-center justify-center bg-green-50 text-green-600"><CalendarCheck2 className="h-4 w-4" /></div>
                  <h3 className="mt-3 text-sm font-semibold">Scheduler status</h3>
                  <p className="mt-1 text-sm text-ink-500">
                    {health.data ? <>API online · AI {health.data.ai.configured ? `live (${health.data.ai.model})` : "in offline mock mode"}</> : health.isError ? "API unreachable" : "Checking…"}
                  </p>
                  <p className="mt-2 text-xs text-ink-400">Due posts are published automatically by the server every 30 seconds.</p>
                </>
              )}
              {open === "approvals" && (
                <>
                  <div className="flex h-9 w-9 items-center justify-center bg-pink-50 text-pink-600"><HeartHandshake className="h-4 w-4" /></div>
                  <h3 className="mt-3 text-sm font-semibold">Approvals</h3>
                  <p className="mt-1 text-sm text-ink-500">Posts marked “needs approval” show on the calendar in amber until a reviewer approves them from the Overview or the post peek.</p>
                  <Button className="mt-4" size="sm" variant="secondary" icon={<Sparkles className="h-4 w-4" />} onClick={() => { setOpen(null); setAiPanelOpen(true); }}>Plan a week with AI</Button>
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
      </Portal>
    </aside>
  );
}
