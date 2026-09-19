import { RotateCw } from "lucide-react";
import { toast } from "sonner";
import { PLATFORM_SPECS, type PlatformConnection } from "@socmedia/shared";
import { Badge, Button, Card, PlatformIcon, StatusBadge, Toggle } from "@/components/ui";
import { compactNumber, relativeTime } from "@/lib/utils";
import type { useConnectionMutations } from "@/hooks/useConnections";
import { TestResultList } from "./TestResultList";

interface Props {
  connection: PlatformConnection;
  mutations: ReturnType<typeof useConnectionMutations>;
  onConfigure: () => void;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

export function ConnectionCardFront({ connection, mutations, onConfigure }: Props) {
  const spec = PLATFORM_SPECS[connection.platform];
  const { update, test, connect, disconnect } = mutations;
  const busy = update.isPending || test.isPending || connect.isPending || disconnect.isPending;
  const connected = connection.status === "connected" && !!connection.displayName;
  const result = test.data ?? connection.lastTest ?? null;

  const handleToggle = (enabled: boolean) => {
    update.mutate({ id: connection.id, input: { enabled } }, { onError: (e) => toast.error(errorMessage(e)) });
  };

  const handleConnect = async () => {
    try {
      const res = await connect.mutateAsync(connection.id);
      if (res.sandbox) {
        toast.success(`${spec.name} connected (sandbox account)`);
      } else {
        window.open(res.authorizeUrl, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const handleDisconnect = () => {
    disconnect.mutate(connection.id, {
      onSuccess: () => toast.message(`${spec.name} disconnected`),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const handleTest = () => {
    test.mutate(connection.id, { onError: (e) => toast.error(errorMessage(e)) });
  };

  return (
    <Card className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <PlatformIcon platform={connection.platform} size={40} />
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-semibold text-ink-900">
              {spec.name}
              {connection.label && <Badge tone="brand">{connection.label}</Badge>}
            </h3>
            <p className="text-xs text-ink-500 line-clamp-2">{spec.description}</p>
          </div>
        </div>
        <Toggle checked={connection.enabled} onChange={handleToggle} disabled={update.isPending} label={`Enable ${spec.name}`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={connection.status} />
        <Badge tone={connection.mode === "live" ? "brand" : "neutral"}>{connection.mode === "live" ? "Live" : "Sandbox"}</Badge>
        <span className="text-xs text-ink-400">Tested {relativeTime(connection.lastTest?.checkedAt)}</span>
      </div>

      {connected ? (
        <div className="flex items-center gap-3 rounded-xl border border-ink-100 bg-ink-50 p-3">
          {connection.avatarUrl ? (
            <img src={connection.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
          ) : (
            <div className="h-10 w-10 shrink-0 rounded-full bg-ink-200" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink-900">{connection.displayName}</p>
            <p className="truncate text-xs text-ink-500">@{connection.handle.replace(/^@+/, "")} · {compactNumber(connection.followers)} followers</p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-ink-200 p-4 text-center text-xs text-ink-400">No account connected</div>
      )}

      {result && <TestResultList result={result} />}

      <div className="mt-auto flex items-end justify-between gap-2 pt-1">
        <div className="flex flex-wrap gap-2">
          {connection.status === "connected" ? (
            <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={busy}>Disconnect</Button>
          ) : (
            <Button variant="primary" size="sm" onClick={handleConnect} loading={connect.isPending} disabled={busy}>Connect</Button>
          )}
          <Button variant="ghost" size="sm" onClick={handleTest} loading={test.isPending} disabled={busy}>Test connection</Button>
        </div>
        <button
          type="button"
          onClick={onConfigure}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          Configure <RotateCw className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </Card>
  );
}
