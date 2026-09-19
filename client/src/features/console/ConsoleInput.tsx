import { useState, type KeyboardEvent } from "react";
import { Loader2 } from "lucide-react";
import { matchingCommands } from "./consoleUtils";

interface ConsoleInputProps {
  history: string[];
  pending: boolean;
  onSubmit: (value: string) => void;
}

/** The `❯` prompt line at the bottom of the console: sends commands, cycles history, hints slash commands. */
export function ConsoleInput({ history, pending, onSubmit }: ConsoleInputProps) {
  const [value, setValue] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const hints = matchingCommands(value);

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
    <div className="border-t px-3 py-2" style={{ borderColor: "var(--c-edge-strong)" }}>
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
      <div className="flex items-center gap-2">
        <span className="text-brand-400" aria-hidden>&#10095;</span>
        <label htmlFor="console-command-input" className="sr-only">Console command</label>
        <input
          id="console-command-input"
          type="text"
          value={value}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command or ask the agent anything…"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink-900 placeholder:text-ink-500 focus:outline-none disabled:opacity-60"
        />
      </div>
    </div>
  );
}
