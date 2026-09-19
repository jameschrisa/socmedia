import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

export interface StatTileProps {
  label: string;
  value: string;
  deltaPct?: number | null;
  data?: { date: string; value: number }[];
  color?: string;
  icon?: React.ReactNode;
  className?: string;
}

/** Compact KPI card: big number, optional delta vs. the previous half of the range, tiny trend line. */
export function StatTile({ label, value, deltaPct, data, color = "#7C5CFC", icon, className }: StatTileProps) {
  const hasDelta = deltaPct !== undefined && deltaPct !== null && Number.isFinite(deltaPct);
  const positive = hasDelta && deltaPct! > 0;
  const negative = hasDelta && deltaPct! < 0;
  const hasTrend = !!data && data.length > 1;
  return (
    <div className={cn("card p-4 min-h-[128px] flex flex-col", className)} data-testid="stat-tile">
      <div className="flex items-center justify-between gap-2">
        <span className="label text-[10px] truncate">{label}</span>
        {icon}
      </div>
      <div className="mt-1.5 flex flex-col gap-2 flex-1">
        <div className="min-w-0">
          <p className="text-xl font-semibold text-ink-900 tabular-nums leading-tight">{value}</p>
          {hasDelta && (
            <p className={cn("mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium whitespace-nowrap", positive ? "text-green-600" : negative ? "text-red-600" : "text-ink-400")}>
              {positive ? <ArrowUpRight className="h-3 w-3" /> : negative ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {Math.abs(deltaPct! * 100).toFixed(1)}%
              <span className="text-ink-400 font-normal">vs prior</span>
            </p>
          )}
        </div>
        {hasTrend && (
          <div className="h-8 w-full min-w-0 overflow-hidden mt-auto" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
