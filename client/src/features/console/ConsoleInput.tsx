import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2 } from "lucide-react";
import { matchingCommands } from "./consoleUtils";

interface ConsoleInputProps {
  history: string[];
  pending: boolean;
  onSubmit: (value: string) => void;
  autoFocus?: boolean;
}

/** The `❯` prompt line at the bottom of the console: sends commands, cycles history, hints slash commands. */
export function ConsoleInput({ history, pending, onSubmit, autoFocus }: ConsoleInputProps) {
  const [value, setValue] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const hints = matchingCommands(value);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
    // Only on mount: re-focusing on every render would steal focus back from elsewhere in the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    onSubmit(trimmed);
    setValue("");
    setHistoryIndex(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "ArrowUp") {
      if (history.length === 0) return;
      e.preventDefault();
      const next = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setValue(history[next] ?? "");
      return;
    }
    if (e.key === "ArrowDown") {
      if (historyIndex <= 0) {
        e.preventDefault();
        setHistoryIndex(-1);
        setValue("");
        return;
      }
      e.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setValue(history[next] ?? "");
    }
  };

  return (
    <div className="border-t px-3 py-2" style={{ borderColor: "var(--c-edge-strong)", paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))" }}>
      {hints.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-ink-500" data-testid="console-hints">
          {hints.map((h) => (
            <span key={h.command}><span className="text-brand-300">{h.command}</span>: {h.description}</span>
          ))}
        </div>
      )}
      {pending && (
        <div className="mb-1 flex items-center gap-2 px-1 text-[12px] text-ink-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Waiting for a reply…
        </div>
      )}
      <div className="flex min-h-[36px] items-center gap-2 sm:min-h-0">
        <span className="text-brand-400" aria-hidden>&#10095;</span>
        <label htmlFor="console-command-input" className="sr-only">Console command</label>
        <input
          ref={inputRef}
          id="console-command-input"
          type="text"
          value={value}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command or ask the agent anything…"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="send"
          className="min-w-0 flex-1 bg-transparent py-1 text-[16px] text-ink-900 placeholder:text-ink-500 focus:outline-none disabled:opacity-60 sm:py-0 sm:text-[13px]"
        />
      </div>
    </div>
  );
}
