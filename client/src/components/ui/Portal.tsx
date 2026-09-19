import { useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Render children at the end of <body> so glass cards (each a stacking context) can never paint over them. */
export function Portal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

export type AnchorAlign = "left" | "right";
export type AnchorSide = "bottom" | "left";

/**
 * Fixed-position coordinates for a floating panel next to an anchor element.
 * Recomputes on scroll/resize while open and keeps the panel inside the viewport.
 */
export function useAnchorPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  opts: { align?: AnchorAlign; side?: AnchorSide; offset?: number; width?: number } = {},
) {
  const { align = "left", side = "bottom", offset = 6, width = 0 } = opts;
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      let top: number;
      let left: number;
      if (side === "left") {
        top = r.top;
        left = r.left - offset - width;
      } else {
        top = r.bottom + offset;
        left = align === "right" ? r.right - width : r.left;
      }
      left = Math.max(8, Math.min(left, vw - width - 8));
      top = Math.max(8, top);
      setPos({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchorRef, open, align, side, offset, width]);

  return pos;
}
