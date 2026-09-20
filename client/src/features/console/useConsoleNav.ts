import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppStore } from "@/store/appStore";

export const CONSOLE_ROUTE = "/console";

/** Navigates to the full-page console, remembering the route to return to on close. */
export function useOpenConsole() {
  const navigate = useNavigate();
  const location = useLocation();
  const setConsoleReturnTo = useAppStore((s) => s.setConsoleReturnTo);
  return useCallback(() => {
    if (location.pathname === CONSOLE_ROUTE) return;
    setConsoleReturnTo(`${location.pathname}${location.search}`);
    navigate(CONSOLE_ROUTE);
  }, [navigate, location.pathname, location.search, setConsoleReturnTo]);
}

/** Navigates back to wherever the console was opened from (default `/`). */
export function useCloseConsole() {
  const navigate = useNavigate();
  const returnTo = useAppStore((s) => s.consoleReturnTo);
  return useCallback(() => navigate(returnTo || "/"), [navigate, returnTo]);
}
