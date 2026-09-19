import { cn } from "@/lib/utils";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-700",
  brand: "bg-brand-50 text-brand-700",
  success: "bg-green-50 text-green-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  info: "bg-sky-50 text-sky-700",
};

export function Badge({ tone = "neutral", className, children, dot }: { tone?: Tone; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]", tones[tone], className)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", tone === "success" ? "bg-green-500" : tone === "danger" ? "bg-red-500" : tone === "warning" ? "bg-amber-500" : tone === "brand" ? "bg-brand-500" : tone === "info" ? "bg-sky-500" : "bg-ink-400")} />}
      {children}
    </span>
  );
}

export const statusTone: Record<string, Tone> = {
  draft: "neutral",
  needs_approval: "warning",
  approved: "info",
  scheduled: "brand",
  publishing: "info",
  published: "success",
  partially_published: "warning",
  failed: "danger",
  connected: "success",
  disconnected: "neutral",
  error: "danger",
  expired: "warning",
  queued: "neutral",
  running: "info",
  succeeded: "success",
  cancelled: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone[status] ?? "neutral"} dot>{status.replace(/_/g, " ")}</Badge>;
}
