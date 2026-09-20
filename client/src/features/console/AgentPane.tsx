import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { AgentCommandResult } from "@socmedia/shared";
import { Portal, useAnchorPosition } from "@/components/ui";
import { useAppStore } from "@/store/appStore";
import { api, ApiError } from "@/lib/api";
import { ConsoleInput } from "./ConsoleInput";
import { SimpleLine } from "./LogLine";
import { BUILTIN_COMMANDS } from "./consoleUtils";

type LocalItem =
  | { kind: "command"; id: string; at: number; text: string }
  | { kind: "reply"; id: string; at: number; result: AgentCommandResult }
  | { kind: "error"; id: string; at: number; text: string };

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : "Something went wrong";
}

/** "Commands" toolbar button: a popover listing every slash command with a one-line description. */
function CommandsPopover() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pos = useAnchorPosition(btnRef, open, { side: "bottom", align: "right", offset: 6, width: 280 });

  // Esc closes just the popover (captured before the page-level listener that closes the whole console)
  // and hands focus back to the trigger so keyboard users don't lose their place.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        data-testid="console-commands-trigger"
        className="focus-ring console-tap px-2 py-1 text-[11px] text-ink-500 hover:text-ink-100"
      >
        Commands
      </button>
      <Portal>
        <AnimatePresence>
          {open && (
            <>
              <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
              <motion.div
                role="menu"
                aria-label="Slash commands"
                data-testid="console-commands-popover"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 }}
                style={{ position: "fixed", top: pos.top, left: pos.left, width: 280 }}
                className="z-[100] glass-menu p-3 text-xs shadow-pop"
              >
                <ul className="space-y-1.5">
                  {BUILTIN_COMMANDS.map((c) => (
                    <li key={c.command}>
                      <span className="text-brand-300">{c.command}</span>{" "}
                      <span className="text-ink-500">{c.description}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </Portal>
    </>
  );
}

/** Left pane: the agent transcript and its command line. Full height, always mounted for the life of the console page. */
export function AgentPane() {
  const history = useAppStore((s) => s.consoleHistory);
  const pushHistory = useAppStore((s) => s.pushConsoleHistory);
  const [items, setItems] = useState<LocalItem[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const agentMutation = useMutation({
    mutationFn: (input: string) => api.agent.command(input),
  });

  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, autoScroll]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };

  const clear = () => setItems([]);

  const runCommand = (text: string) => {
    if (text === "/clear") {
      clear();
      return;
    }
    const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setItems((old) => [...old, { kind: "command", id, at: Date.now(), text }]);
    pushHistory(text);
    agentMutation.mutate(text, {
      onSuccess: (result) => {
        setItems((old) => [...old, { kind: "reply", id: `${id}-reply`, at: Date.now(), result }]);
      },
      onError: (e) => {
        setItems((old) => [...old, { kind: "error", id: `${id}-error`, at: Date.now(), text: errorMessage(e) }]);
      },
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-1.5" style={{ borderColor: "var(--c-edge)" }}>
        <span className="text-sm font-semibold text-ink-900">Agent</span>
        <div className="flex items-center gap-1">
          <CommandsPopover />
          <button
            type="button"
            onClick={clear}
            aria-label="Clear agent transcript"
            title="Clear"
            className="focus-ring console-tap flex h-7 w-7 items-center justify-center text-ink-500 hover:bg-glass-veil hover:text-ink-900"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin py-1" data-testid="agent-scroll">
        {items.length === 0 && (
          <div className="px-3 py-3 text-xs leading-relaxed text-ink-500" data-testid="agent-empty">
            <p>
              Type <span className="text-brand-300">/help</span> to see what the agent can do, or open{" "}
              <span className="text-brand-300">Commands</span> above for the full list.
            </p>
          </div>
        )}
        {items.map((item) => {
          if (item.kind === "command") return <div key={item.id} className="term-cmd"><SimpleLine prefix="you ❯" text={item.text} /></div>;
          if (item.kind === "error") return <SimpleLine key={item.id} prefix="agent ❯" text={item.text} tone="error" />;
          return (
            <div key={item.id} className="term-reply">
              <SimpleLine prefix="agent ❯" text={item.result.reply} />
              {item.result.actions.map((a, i) => (
                <SimpleLine key={`${item.id}-action-${i}`} text={`↳ ${a.tool}: ${a.summary}`} tone="muted" />
              ))}
            </div>
          );
        })}
      </div>

      <ConsoleInput history={history} pending={agentMutation.isPending} onSubmit={runCommand} autoFocus />
    </div>
  );
}
