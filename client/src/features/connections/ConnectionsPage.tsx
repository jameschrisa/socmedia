import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { PLATFORMS, PLATFORM_SPECS, isPlatform } from "@socmedia/shared";
import { Button, EmptyState, Skeleton } from "@/components/ui";
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
  const byPlatform = new Map(connections.map((c) => [c.platform, c]));
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
          <p className="mt-1 text-sm text-ink-500">Connect and configure publishing credentials for each network.</p>
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
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {PLATFORMS.map((platform) => {
            const connection = byPlatform.get(platform);
            return connection ? <ConnectionCard key={connection.id} connection={connection} /> : null;
          })}
        </div>
      )}
    </div>
  );
}
