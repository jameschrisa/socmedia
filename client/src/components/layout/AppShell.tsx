import { Outlet, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { TopNav } from "./TopNav";
import { RightRail } from "./RightRail";
import { useOrgs } from "@/hooks/useOrg";
import { useCardFocus } from "@/hooks/useCardFocus";
import { AiPanel } from "@/features/ai/AiPanel";
import { ComposerDrawer } from "@/features/studio/ComposerDrawer";

export function AppShell() {
  const { isError, error, refetch } = useOrgs();
  useCardFocus("main");
  const location = useLocation();
  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 sm:px-6 py-6">
        {isError ? (
          <div className="card p-8 text-center">
            <h2 className="text-lg font-semibold">Can't reach the Pulse API</h2>
            <p className="mt-1 text-sm text-ink-500">{(error as Error)?.message}. Start the server with <code className="rounded bg-ink-100 px-1">npm run dev</code>.</p>
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
      <Toaster position="bottom-right" theme="dark" closeButton toastOptions={{ className: "text-sm glass-sheet !rounded-2xl" }} />
    </div>
  );
}
