import { AnimatePresence, motion } from "framer-motion";
import { Check, X } from "lucide-react";
import type { ConnectionTestResult } from "@socmedia/shared";
import { cn } from "@/lib/utils";

/** Animated checklist rendered inline on the connection card after a test run. */
export function TestResultList({ result }: { result: ConnectionTestResult }) {
  return (
    <div
      data-testid="test-result"
      className={cn(
        "rounded-xl border p-3 text-xs space-y-2",
        result.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-sm font-medium", result.ok ? "text-green-700" : "text-red-700")}>{result.message}</span>
        <span className="shrink-0 text-ink-400">{result.latencyMs}ms</span>
      </div>
      <ul className="space-y-1">
        <AnimatePresence initial={false}>
          {result.details.map((detail, i) => (
            <motion.li
              key={detail.label}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04, type: "spring", stiffness: 400, damping: 30 }}
              className="flex items-center gap-1.5 text-ink-600"
            >
              {detail.ok ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden />
              ) : (
                <X className="h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden />
              )}
              <span className="font-medium text-ink-700">{detail.label}</span>
              {detail.info && <span className="text-ink-400">{detail.info}</span>}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
