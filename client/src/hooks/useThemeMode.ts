import { useEffect, useState } from "react";
import { useAppStore, type ThemePref } from "@/store/appStore";

export type ThemeMode = "dark" | "light";

function systemMode(): ThemeMode {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function resolveTheme(pref: ThemePref): ThemeMode {
  return pref === "system" ? systemMode() : pref;
}

/** Applies the stored theme preference to <html data-theme> and returns the resolved mode. */
export function useThemeMode(): ThemeMode {
  const pref = useAppStore((s) => s.theme);
  const [mode, setMode] = useState<ThemeMode>(() => resolveTheme(pref));

  useEffect(() => {
    const apply = () => {
      const next = resolveTheme(pref);
      setMode(next);
      document.documentElement.dataset.theme = next;
    };
    apply();
    if (pref !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const listener = () => apply();
    mq.addEventListener?.("change", listener);
    return () => mq.removeEventListener?.("change", listener);
  }, [pref]);

  return mode;
}
