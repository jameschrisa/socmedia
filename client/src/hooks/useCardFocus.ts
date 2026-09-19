import { useEffect } from "react";

export const CARD_FOCUS_ATTR = "data-focused";

/**
 * Marks the clicked card (closest `.card` inside the given root) as focused so its border highlights.
 * Clicking a different card moves the highlight; clicking outside any card clears it.
 * Cards inside dialogs/drawers (rendered outside the root) are ignored.
 */
export function applyCardFocus(target: Element | null, root: ParentNode): Element | null {
  const card = target?.closest?.(".card") ?? null;
  const inRoot = card ? root.contains(card) : false;
  root.querySelectorAll(`.card[${CARD_FOCUS_ATTR}]`).forEach((el) => { if (el !== card) el.removeAttribute(CARD_FOCUS_ATTR); });
  if (card && inRoot) {
    card.setAttribute(CARD_FOCUS_ATTR, "true");
    return card;
  }
  return null;
}

export function useCardFocus(rootSelector = "main") {
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = document.querySelector(rootSelector);
      if (!root) return;
      const target = e.target as Element | null;
      // clicks inside overlays (modals, drawers, popovers) should not disturb the page highlight
      if (target?.closest?.("[role='dialog']")) return;
      applyCardFocus(target, root);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [rootSelector]);
}
