import type { ReactNode } from "react";
import { useAuth, type Capability } from "@/hooks/useAuth";
import { LoginPage } from "./LoginPage";

/**
 * Gates the whole app behind a session. Shown while the session is loading, then
 * swaps to LoginPage when there's no valid session (including first-run setup and
 * a pending forced password change), otherwise renders the app.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, authenticated, needsSetup, user } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="auth-loading">
        <div className="flex items-center gap-2 text-ink-400">
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" aria-hidden />
          <span className="text-sm">Loading suprstar…</span>
        </div>
      </div>
    );
  }

  if (!authenticated || needsSetup || user?.mustChangePassword) {
    return <LoginPage />;
  }

  return <>{children}</>;
}

/** Renders children only when the current user has a given capability, else a small notice. */
export function RequireRole({ capability, children }: { capability: Capability; children: ReactNode }) {
  const { can } = useAuth();
  if (!can[capability]) {
    return (
      <div className="card p-6 text-sm text-ink-500" data-testid="no-access">
        You don't have access to this section.
      </div>
    );
  }
  return <>{children}</>;
}
