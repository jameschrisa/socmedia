import { format, parseISO } from "date-fns";
import type { LogEntry } from "@socmedia/shared";
import { LEVEL_CLASS, splitLinkify } from "./consoleUtils";

function timeOf(iso: string): string {
  try {
    return format(parseISO(iso), "HH:mm:ss");
  } catch {
    return "--:--:--";
  }
}

function Linkified({ text }: { text: string }) {
  const parts = splitLinkify(text);
  return (
    <>
      {parts.map((p, i) =>
        p.isUrl ? (
          <a key={i} href={p.text} target="_blank" rel="noreferrer" className="term-link">{p.text}</a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** One rendered line from the server log stream: `HH:mm:ss  LEVEL  source  message`. */
export function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <div className="term-line flex flex-wrap items-baseline gap-x-2 px-3 py-0.5 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">
      <span className="text-ink-500">{timeOf(entry.at)}</span>
      <span className={`w-12 shrink-0 font-semibold uppercase ${LEVEL_CLASS[entry.level]}`}>{entry.level}</span>
      <span className="text-brand-300">{entry.source}</span>
      <span className="min-w-0 flex-1 break-words text-ink-800"><Linkified text={entry.message} /></span>
    </div>
  );
}

/** A locally-generated line: the echoed command, an agent reply, a client error, or a system note. */
export function SimpleLine({ prefix, text, tone = "default" }: { prefix?: string; text: string; tone?: "default" | "error" | "muted" }) {
  const toneClass = tone === "error" ? "text-red-500" : tone === "muted" ? "text-ink-500" : "text-ink-800";
  return (
    <div className="term-line px-3 py-0.5 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">
      {prefix && <span className="mr-2 text-brand-300">{prefix}</span>}
      <span className={`whitespace-pre-wrap break-words ${toneClass}`}><Linkified text={text} /></span>
    </div>
  );
}
