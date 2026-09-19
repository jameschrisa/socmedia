import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { Select } from "@/components/ui";
import { cn } from "@/lib/utils";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const TAIL_OPTIONS = [100, 500, 1000, 5000];

/** Admin-only "Log files" tab: the on-disk rotated log files and a tail viewer. */
export function LogFilesPanel() {
  const [selected, setSelected] = useState<string | null>(null);
  const [tail, setTail] = useState(500);
  const filesQuery = useQuery({ queryKey: qk.logFiles, queryFn: api.logs.files });
  const fileQuery = useQuery({
    queryKey: qk.logFile(selected ?? "", tail),
    queryFn: () => api.logs.file(selected!, tail),
    enabled: !!selected,
  });

  const files = filesQuery.data?.files ?? [];

  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-40 shrink-0 overflow-y-auto scrollbar-thin border-r sm:w-56" style={{ borderColor: "var(--c-edge)" }}>
        {filesQuery.isLoading && <p className="p-3 text-xs text-ink-500">Loading files…</p>}
        {filesQuery.isError && (
          <div className="p-3 text-xs text-red-500">
            <p>Couldn't load log files.</p>
            <button type="button" onClick={() => filesQuery.refetch()} className="focus-ring mt-1.5 underline underline-offset-2 text-ink-700 hover:text-ink-900">Try again</button>
          </div>
        )}
        {!filesQuery.isLoading && !filesQuery.isError && files.length === 0 && <p className="p-3 text-xs text-ink-500">No log files yet. Files appear here once the server writes its first rotated log.</p>}
        {files.map((f) => (
          <button
            key={f.name}
            type="button"
            onClick={() => setSelected(f.name)}
            aria-current={selected === f.name ? "true" : undefined}
            className={cn(
              "focus-ring flex w-full items-start gap-2 border-b px-3 py-2 text-left text-xs focus-visible:ring-inset",
              selected === f.name ? "bg-glass-strong text-ink-900" : "text-ink-600 hover:bg-glass-veil",
            )}
            style={{ borderColor: "var(--c-edge)" }}
          >
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate">{f.name}</span>
              <span className="block text-[10.5px] text-ink-500">{formatBytes(f.size)} · {new Date(f.modifiedAt).toLocaleString()}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5" style={{ borderColor: "var(--c-edge)" }}>
              <span className="truncate text-xs text-ink-500">{selected}</span>
              <label className="flex items-center gap-1.5 text-[11px] text-ink-500">
                Lines
                <Select value={tail} onChange={(e) => setTail(Number(e.target.value))} className="!h-7 !py-0 text-xs">
                  {TAIL_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </label>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto scrollbar-thin whitespace-pre-wrap break-words px-3 py-2 text-[11.5px] text-ink-700">
              {fileQuery.isLoading ? "Loading…" : fileQuery.isError ? "Couldn't load this file." : (fileQuery.data?.lines.join("\n") || "This file is empty.")}
            </pre>
            {fileQuery.isError && (
              <div className="border-t px-3 py-1.5" style={{ borderColor: "var(--c-edge)" }}>
                <button type="button" onClick={() => fileQuery.refetch()} className="focus-ring text-xs underline underline-offset-2 text-ink-700 hover:text-ink-900">Try again</button>
              </div>
            )}
          </>
        ) : (
          <p className="p-4 text-xs leading-relaxed text-ink-500">Pick a file on the left to read its last lines. Newest files sit at the top.</p>
        )}
      </div>
    </div>
  );
}
