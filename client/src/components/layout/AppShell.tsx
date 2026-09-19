import { Outlet, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { TopNav } from "./TopNav";
import { RightRail } from "./RightRail";
import { useOrgs } from "@/hooks/useOrg";
import { useCardFocus } from "@/hooks/useCardFocus";
import { useThemeMode } from "@/hooks/useThemeMode";
import { AiPanel } from "@/features/ai/AiPanel";
import { ComposerDrawer } from "@/features/studio/ComposerDrawer";
import { ConsoleDrawer } from "@/features/console/ConsoleDrawer";
import { ApiError } from "@/lib/api";

export function AppShell() {
  const { isError, error, refetch } = useOrgs();
  // 401s mean the session ended; RequireAuth already handles showing the login
  // screen for that, so this card should only ever appear for real API outages.
  const unreachable = isError && !(error instanceof ApiError && error.status === 401);
  useCardFocus("main");
  const location = useLocation();
  const mode = useThemeMode();
  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 sm:px-6 py-6">
        {unreachable ? (
          <div className="card p-8 text-center">
            <h2 className="text-lg font-semibold">Can't reach the suprstar API</h2>
            <p className="mt-1 text-sm text-ink-500">
              {(error as Error)?.message}.{" "}
              {import.meta.env.PROD
                ? "The API is not reachable from this deployment. Deploy the server (see README → Deploy) and point the /api rewrite at its host."
                : <>Start the server with <code className="bg-ink-100 px-1">npm run dev</code>.</>}
            </p>
            <button className="link mt-3 text-sm" onClick={() => refetch()}>Retry</button>
          </div>
        ) : (
          <div className="flex gap-6 items-start">
            <div className="flex-1 min-w-0 drift-in" key={location.pathname}><Outlet /></div>
            <RightRail />
          </div>
        )}
      </main>
      <AiPanel />
      <ComposerDrawer />
      <ConsoleDrawer />
      <Toaster position="bottom-right" theme={mode} closeButton toastOptions={{ className: "text-sm glass-sheet !rounded-2xl" }} />
    </div>
  );
}
