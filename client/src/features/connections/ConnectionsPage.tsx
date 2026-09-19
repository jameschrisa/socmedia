import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Link2, Plus } from "lucide-react";
import { PLATFORMS, PLATFORM_SPECS, isPlatform, type Platform } from "@socmedia/shared";
import { Button, EmptyState, PlatformIcon, Skeleton } from "@/components/ui";
import { AddAccountModal } from "./AddAccountModal";
import { useConnectionMutations, useConnections } from "@/hooks/useConnections";
import { ConnectionCard } from "./ConnectionCard";

/** Handles the `?connected=<platform>` / `?error=` redirect from the OAuth callback. */
function useOAuthRedirectToast() {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (!connected && !error) return;

    if (connected) {
      const name = isPlatform(connected) ? PLATFORM_SPECS[connected].name : connected;
      toast.success(`${name} connected successfully`);
    }
    if (error) {
      toast.error(`Connection failed: ${error}`);
    }

    const next = new URLSearchParams(searchParams);
    next.delete("connected");
    next.delete("error");
    setSearchParams(next, { replace: true });
    // Only run this reconciliation when the params actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
}

export function ConnectionsPage() {
  useOAuthRedirectToast();
  const { data, isLoading } = useConnections();
  const { test } = useConnectionMutations();

  const connections = data ?? [];
  const [adding, setAdding] = useState<Platform | null>(null);
  const byPlatform = new Map<Platform, typeof connections>();
  for (const p of PLATFORMS) byPlatform.set(p, connections.filter((c) => c.platform === p));
  const connectedCount = connections.filter((c) => c.status === "connected").length;
  const sandboxCount = connections.filter((c) => c.mode === "sandbox").length;
  const liveCount = connections.filter((c) => c.mode === "live").length;

  const testAll = async () => {
    if (!connections.length) return;
    const results = await Promise.allSettled(connections.map((c) => test.mutateAsync(c.id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) toast.success("All connections tested");
    else toast.error(`${failed} connection${failed > 1 ? "s" : ""} failed testing`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Social Profiles</h1>
          <p className="mt-1 text-sm text-ink-500">Connect and configure publishing credentials for each network. Add as many accounts per network as you need.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="card flex items-center gap-4 px-4 py-2.5 text-sm">
            <div>
              <span className="font-semibold text-ink-900">{connectedCount}</span>
              <span className="text-ink-500">/{connections.length} connected</span>
            </div>
            <div className="h-4 w-px bg-ink-200" aria-hidden />
            <div className="text-ink-500">{sandboxCount} sandbox · {liveCount} live</div>
          </div>
          <Button variant="outline" size="sm" onClick={testAll} loading={test.isPending} disabled={!connections.length}>
            Test all
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {PLATFORMS.map((p) => <Skeleton key={p} className="h-[320px] rounded-2xl" />)}
        </div>
      ) : connections.length === 0 ? (
        <EmptyState
          icon={<Link2 className="h-8 w-8" />}
          title="No connections yet"
          description="Connections are seeded automatically when an organization is created."
        />
      ) : (
        <div className="space-y-8">
          {PLATFORMS.map((platform) => {
            const accounts = byPlatform.get(platform) ?? [];
            const spec = PLATFORM_SPECS[platform];
            return (
              <section key={platform} className="space-y-3" data-testid={`platform-group-${platform}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <PlatformIcon platform={platform} size={28} />
                    <h2 className="font-sans text-sm font-semibold text-ink-900">{spec.name}</h2>
                    <span className="text-xs text-ink-500">{accounts.length} {accounts.length === 1 ? "account" : "accounts"}</span>
                  </div>
                  <Button variant="outline" size="xs" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(platform)} data-testid={`add-account-${platform}`}>Add account</Button>
                </div>
                {accounts.length === 0 ? (
                  <p className="text-xs text-ink-500">No {spec.name} accounts yet.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    {accounts.map((connection) => <ConnectionCard key={connection.id} connection={connection} siblingCount={accounts.length} />)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      {adding && <AddAccountModal open platform={adding} siblings={byPlatform.get(adding) ?? []} onClose={() => setAdding(null)} />}
    </div>
  );
}
