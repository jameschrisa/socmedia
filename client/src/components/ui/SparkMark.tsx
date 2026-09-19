import { cn } from "@/lib/utils";

/** Three-sparkle mark used beside the wordmark. Fills are fixed brand yellows; the outline follows the text colour. */
export function SparkMark({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className={cn("shrink-0 text-ink-900", className)} aria-hidden>
      <clipPath id="c324240"><path d="M324,54 Q324,240 510,240 Q324,240 324,426 Q324,240 138,240 Q324,240 324,54 Z"/></clipPath><path d="M324,54 Q324,240 510,240 Q324,240 324,426 Q324,240 138,240 Q324,240 324,54 Z" fill="#F5A02B"/><path clipPath="url(#c324240)" d="M138,240 Q324,240 324,426 L138,426 Z" fill="#E8902A"/><path d="M324,54 Q324,240 510,240 Q324,240 324,426 Q324,240 138,240 Q324,240 324,54 Z" fill="none" stroke="currentColor" strokeWidth="26" strokeLinejoin="round" strokeLinecap="round"/><clipPath id="c84124"><path d="M84,54 Q84,124 154,124 Q84,124 84,194 Q84,124 14,124 Q84,124 84,54 Z"/></clipPath><path d="M84,54 Q84,124 154,124 Q84,124 84,194 Q84,124 14,124 Q84,124 84,54 Z" fill="#F5D95A"/><path clipPath="url(#c84124)" d="M14,124 Q84,124 84,194 L14,194 Z" fill="#EFC93A"/><path d="M84,54 Q84,124 154,124 Q84,124 84,194 Q84,124 14,124 Q84,124 84,54 Z" fill="none" stroke="currentColor" strokeWidth="20" strokeLinejoin="round" strokeLinecap="round"/><clipPath id="c172388"><path d="M172,316 Q172,388 244,388 Q172,388 172,460 Q172,388 100,388 Q172,388 172,316 Z"/></clipPath><path d="M172,316 Q172,388 244,388 Q172,388 172,460 Q172,388 100,388 Q172,388 172,316 Z" fill="#F8E8A8"/><path clipPath="url(#c172388)" d="M100,388 Q172,388 172,460 L100,460 Z" fill="#F2D98A"/><path d="M172,316 Q172,388 244,388 Q172,388 172,460 Q172,388 100,388 Q172,388 172,316 Z" fill="none" stroke="currentColor" strokeWidth="20" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}
