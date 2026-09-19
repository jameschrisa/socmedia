import { cn } from "@/lib/utils";

/**
 * "suprstar" wordmark: bold geometric sans, lowercase, tightly tracked with two
 * kerned pairs ("pr" and "ta") pulled together so they read as ligatures.
 */
export function Wordmark({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "text-lg", md: "text-[22px]", lg: "text-4xl" };
  return (
    <span className={cn("wordmark select-none", sizes[size], className)} aria-label="suprstar" data-testid="wordmark">
      su<span className="wm-lig">pr</span>s<span className="wm-lig">ta</span>r
    </span>
  );
}
