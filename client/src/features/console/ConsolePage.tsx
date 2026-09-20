import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { X } from "lucide-react";
import { SegmentedTabs, SparkMark } from "@/components/ui";
import { useAppStore, CONSOLE_SPLIT_MIN, CONSOLE_SPLIT_MAX } from "@/store/appStore";
import { useAuth } from "@/hooks/useAuth";
import { useOrgs } from "@/hooks/useOrg";
import { cn } from "@/lib/utils";
import { AgentPane } from "./AgentPane";
import { ActivityLogPane } from "./ActivityLogPane";
import { TerminalPane } from "./TerminalPane";
import { useCloseConsole } from "./useConsoleNav";

type RightTab = "activity" | "terminal";
type MobilePane = "agent" | "right";

/**
 * Full-page console: an "Agent" pane (transcript + command line) beside an "Activity log" /
 * "Terminal" pane, split by a draggable divider on wide screens and a segmented switch below
 * 1024px. Always dark via the `.terminal` tokens, independent of the app's light/dark theme.
 */
export function ConsolePage() {
  const closeConsole = useCloseConsole();
  const { currentOrg } = useOrgs();
  const { user } = useAuth();
  const split = useAppStore((s) => s.consoleSplit);
  const setSplit = useAppStore((s) => s.setConsoleSplit);

  const [rightTab, setRightTab] = useState<RightTab>("activity");
  const [mobilePane, setMobilePane] = useState<MobilePane>("agent");
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startSplit: number; width: number } | null>(null);

  // Esc closes the console unless focus is inside the OS terminal (xterm handles its own Escape).
  // Ctrl+` closes it from anywhere on this page (it opens the console from the rest of the app).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === "Backquote") {
        e.preventDefault();
        closeConsole();
        return;
      }
      if (e.key === "Escape") {
        const active = document.activeElement as HTMLElement | null;
        if (active?.closest(".xterm")) return;
        e.preventDefault();
        closeConsole();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeConsole]);

  const startDrag = (e: ReactPointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { startX: e.clientX, startSplit: split, width: rect.width };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDrag = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const { startX, startSplit, width } = dragRef.current;
    if (width <= 0) return;
    setSplit(startSplit + (e.clientX - startX) / width);
  };
  const endDrag = () => { dragRef.current = null; };
  const onHandleKey = (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 0.08 : 0.02;
    if (e.key === "ArrowLeft") { e.preventDefault(); setSplit(split - step); }
    if (e.key === "ArrowRight") { e.preventDefault(); setSplit(split + step); }
  };

  return (
    // Fixed to the viewport height (dvh so phone browser chrome is accounted for) and overflow hidden,
    // so each pane scrolls internally and the command line stays pinned to the bottom edge.
    <div className="terminal console-page flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2 sm:px-6 sm:py-3" style={{ borderColor: "var(--c-edge-strong)" }}>
        <div className="flex min-w-0 items-center gap-2.5">
          <SparkMark size={22} className="text-ink-900" />
          <h1 className="font-display text-lg font-semibold text-ink-900">Console</h1>
          {currentOrg?.name && (
            <>
              <span className="hidden text-ink-500 sm:inline" aria-hidden>·</span>
              <span className="hidden truncate text-sm text-ink-500 sm:inline">{currentOrg.name}</span>
            </>
          )}
          {user?.name && (
            <>
              <span className="hidden text-ink-500 sm:inline" aria-hidden>·</span>
              <span className="hidden truncate text-sm text-ink-500 sm:inline">{user.name}</span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={closeConsole}
          data-testid="console-close"
          title="Close console (Esc)"
          className="focus-ring console-tap inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm text-ink-700 hover:bg-glass-veil hover:text-ink-900"
          style={{ borderColor: "var(--c-edge)" }}
        >
          <X className="h-4 w-4" aria-hidden /> Close console
        </button>
      </header>

      <div className="console-mobile-switch shrink-0 border-b px-3 py-2 lg:hidden" style={{ borderColor: "var(--c-edge)" }}>
        <SegmentedTabs
          className="w-full [&>button]:flex-1"
          value={mobilePane}
          onChange={setMobilePane}
          items={[{ id: "agent", label: "Agent" }, { id: "right", label: "Activity & terminal" }]}
        />
      </div>

      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col lg:flex-row" style={{ "--split": split } as React.CSSProperties}>
        <div className={cn("console-split-left min-h-0 flex-col", mobilePane === "agent" ? "flex" : "hidden", "lg:flex")}>
          <AgentPane />
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panes"
          aria-valuenow={Math.round(split * 100)}
          aria-valuemin={Math.round(CONSOLE_SPLIT_MIN * 100)}
          aria-valuemax={Math.round(CONSOLE_SPLIT_MAX * 100)}
          tabIndex={0}
          title="Drag to resize. Arrow keys resize from the keyboard."
          className="console-split-handle hidden shrink-0 cursor-col-resize select-none items-center justify-center lg:flex"
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onHandleKey}
          data-testid="console-split-handle"
        >
          <span className="h-10 w-1 rounded-full bg-ink-300 transition-colors" aria-hidden />
        </div>

        <div className={cn("console-split-right min-h-0 flex-col", mobilePane === "right" ? "flex" : "hidden", "lg:flex")}>
          <div className="flex shrink-0 items-center border-b px-3 py-1.5" style={{ borderColor: "var(--c-edge)" }} data-testid="console-right-tab">
            <SegmentedTabs
              size="sm"
              value={rightTab}
              onChange={setRightTab}
              items={[{ id: "activity", label: "Activity log" }, { id: "terminal", label: "Terminal" }]}
            />
          </div>
          {rightTab === "activity" ? <ActivityLogPane /> : <TerminalPane />}
        </div>
      </div>
    </div>
  );
}
