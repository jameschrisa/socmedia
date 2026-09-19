import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Filter } from "lucide-react";
import { PLATFORMS, PLATFORM_SPECS, type Platform } from "@socmedia/shared";
import { PlatformIcon, Portal, useAnchorPosition } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface PlatformFilterDropdownProps {
  active: Set<Platform>;
  onToggle: (p: Platform) => void;
  onSetAll: (all: boolean) => void;
}

/** Dropdown multi-select for the calendar's platform filter. All platforms are selected by default. */
export function PlatformFilterDropdown({ active, onToggle, onSetAll }: PlatformFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  // Portalled to <body> so glass cards (which create stacking contexts) can never paint over it.
  const pos = useAnchorPosition(ref, open, { align: "left", offset: 6, width: 240 });
  const count = active.size;
  const allSelected = count === PLATFORMS.length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const label = allSelected ? "All platforms" : count === 0 ? "No platforms" : count === 1 ? PLATFORM_SPECS[[...active][0]!].name : `${count} of ${PLATFORMS.length} platforms`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Filter by platform"
        data-testid="platform-filter"
        onClick={() => setOpen((o) => !o)}
        className={cn("inline-flex h-9 items-center gap-2 border bg-glass px-3 text-sm font-medium text-ink-700 transition-colors hover:border-ink-300", open ? "border-brand-400 ring-2 ring-brand-200" : "border-ink-200", !allSelected && "border-brand-300 text-brand-700")}
      >
        <Filter className="h-4 w-4 text-ink-400" />
        <span className="flex -space-x-1">
          {PLATFORMS.filter((p) => active.has(p)).map((p) => (
            <PlatformIcon key={p} platform={p} size={18} className="ring-1 ring-white" />
          ))}
        </span>
        <span>{label}</span>
        <ChevronDown className={cn("h-4 w-4 text-ink-400 transition-transform", open && "rotate-180")} />
      </button>

      <Portal>
      <AnimatePresence>
        {open && (
          <motion.ul
            ref={menuRef}
            role="listbox"
            aria-multiselectable="true"
            aria-label="Platforms"
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="z-[100] w-60 card glass-menu p-1.5 shadow-pop"
            data-testid="platform-filter-menu"
          >
            {PLATFORMS.map((p) => {
              const selected = active.has(p);
              return (
                <li key={p}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-label={`Toggle ${p} filter`}
                    onClick={() => onToggle(p)}
                    className={cn("flex w-full items-center gap-2.5 px-2 py-1.5 text-left text-sm hover:bg-ink-50", selected ? "text-ink-900" : "text-ink-500")}
                  >
                    <span className={cn("flex h-4 w-4 items-center justify-center border", selected ? "border-brand-500 bg-brand-500 text-white" : "border-ink-300 bg-glass")} aria-hidden>
                      {selected && <Check className="h-3 w-3" />}
                    </span>
                    <PlatformIcon platform={p} size={22} mono={!selected} />
                    <span className="flex-1">{PLATFORM_SPECS[p].name}</span>
                  </button>
                </li>
              );
            })}
            <li className="mt-1 flex items-center justify-between border-t border-ink-100 px-2 pt-1.5 text-xs">
              <button type="button" className="link" onClick={() => onSetAll(true)} disabled={allSelected}>Select all</button>
              <button type="button" className="text-ink-500 hover:text-ink-800" onClick={() => onSetAll(false)} disabled={count === 0}>Clear</button>
            </li>
          </motion.ul>
        )}
      </AnimatePresence>
      </Portal>
    </div>
  );
}
