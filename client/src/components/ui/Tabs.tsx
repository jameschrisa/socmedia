import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface TabItem<T extends string = string> { id: T; label: React.ReactNode; badge?: React.ReactNode }

export function SegmentedTabs<T extends string>({ items, value, onChange, className, size = "sm" }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; className?: string; size?: "sm" | "md" }) {
  return (
    <div className={cn("inline-flex items-center rounded-full bg-ink-100 p-1", className)} role="tablist">
      {items.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn("relative rounded-full font-medium transition-colors", size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm", active ? "text-ink-900" : "text-ink-500 hover:text-ink-700")}
          >
            {active && <motion.span layoutId={`seg-${items.map((i) => i.id).join("-")}`} className="absolute inset-0 rounded-full bg-ink-300 shadow-sm" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
            <span className="relative z-10 inline-flex items-center gap-1.5">{t.label}{t.badge}</span>
          </button>
        );
      })}
    </div>
  );
}
