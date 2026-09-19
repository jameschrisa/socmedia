import { cn } from "@/lib/utils";

/** "suprstar" wordmark: bold geometric sans, lowercase, tight tracking with a little air. */
export function Wordmark({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "text-lg", md: "text-[22px]", lg: "text-4xl" };
  return (
    <span className={cn("wordmark select-none", sizes[size], className)} aria-label="suprstar" data-testid="wordmark">
      suprstar
    </span>
  );
}
