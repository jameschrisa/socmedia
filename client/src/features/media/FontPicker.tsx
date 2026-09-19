import { useEffect, useState } from "react";
import { FONTS, SANS_FONTS, SERIF_FONTS, fontStack } from "@/lib/fontManifest";
import { cn } from "@/lib/utils";

/** Make sure a self-hosted font face is loaded before the canvas draws with it. */
export function useFontReady(family: string, weight: 400 | 700 = 700): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fonts?.load) { setReady(true); return; }
    fonts.load(`${weight} 16px "${family}"`).then(() => { if (!cancelled) setReady(true); }).catch(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [family, weight]);
  return ready;
}

interface FontPickerProps {
  value: string;
  onChange: (family: string) => void;
  className?: string;
}

/** Grouped select of the 24 self-hosted Google Fonts, each option previewed in its own face. */
export function FontPicker({ value, onChange, className }: FontPickerProps) {
  const current = FONTS.find((f) => f.family === value) ?? FONTS[0]!;
  return (
    <label className={cn("flex items-center gap-2 text-xs", className)}>
      <span className="shrink-0 text-ink-500">Font</span>
      <select
        aria-label="Font family"
        data-testid="font-picker"
        className="input h-8 flex-1 py-0 text-sm"
        style={{ fontFamily: fontStack(current.family) }}
        value={current.family}
        onChange={(e) => onChange(e.target.value)}
      >
        <optgroup label="Sans-serif">
          {SANS_FONTS.map((f) => (
            <option key={f.family} value={f.family} style={{ fontFamily: fontStack(f.family) }}>{f.family}</option>
          ))}
        </optgroup>
        <optgroup label="Serif">
          {SERIF_FONTS.map((f) => (
            <option key={f.family} value={f.family} style={{ fontFamily: fontStack(f.family) }}>{f.family}</option>
          ))}
        </optgroup>
      </select>
      <span className="hidden sm:inline rounded bg-ink-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-500">{current.category === "serif" ? "Serif" : "Sans"}</span>
    </label>
  );
}
