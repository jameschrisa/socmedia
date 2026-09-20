import { toast } from "sonner";
import { PLATFORM_SPECS, type InboundChannel } from "@socmedia/shared";
import { Badge, Button } from "@/components/ui";
import { useConnections } from "@/hooks/useConnections";
import { useInboundBindingMutations, useInboundBindings } from "@/hooks/useInbound";
import { useOrgs } from "@/hooks/useOrg";
import { ApiError } from "@/lib/api";
import { CHANNEL_SHORT_LABEL, maskSenderId } from "./inboundUtils";

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong";
}

const STATUS_TONE = { pending: "warning", verified: "success", revoked: "neutral" } as const;
const STATUS_LABEL = { pending: "Pending", verified: "Verified", revoked: "Revoked" } as const;

/** Every sender linked to post through a chat channel: who they are, what they can post to, and
 * whether they're still verified. `onRelink` reopens the setup wizard on that channel after a revoked
 * binding is removed, so "Re-link" is one action rather than a delete plus a hunt for the button. */
export function InboundBindingsTable({ onRelink }: { onRelink?: (channel: InboundChannel) => void } = {}) {
  const { data: bindings = [], isLoading, isError, refetch } = useInboundBindings();
  const { data: connections = [] } = useConnections();
  const { orgs } = useOrgs();
  const { update, remove } = useInboundBindingMutations();

  const accountLabel = (ids: string[]) => {
    if (ids.length === 0) return "All enabled accounts";
    const names = ids.map((id) => connections.find((c) => c.id === id)).filter(Boolean).map((c) => c!.label || c!.displayName || PLATFORM_SPECS[c!.platform].name);
    return names.length ? names.join(", ") : `${ids.length} account${ids.length === 1 ? "" : "s"}`;
  };
  const orgName = (orgId: string) => orgs.find((o) => o.id === orgId)?.name ?? orgId;

  const revoke = (id: string) => {
    update.mutate({ id, input: { status: "revoked" } }, {
      onSuccess: () => toast.success("Sender revoked. Their messages are ignored until they are linked again."),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };
  const relink = (id: string, channel: InboundChannel) => {
    remove.mutate(id, {
      onSuccess: () => {
        if (onRelink) { toast.success("Removed. Link the sender again to restore access."); onRelink(channel); }
        else toast.success('Removed. Use "Set up a channel" to link this sender again.');
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  if (isLoading) return <p className="py-4 text-sm text-ink-500">Loading linked senders…</p>;
  if (isError) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-ink-500">
        <p>Could not load linked senders.</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }
  if (bindings.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-ink-500">
        <p className="font-medium text-ink-700">No senders linked yet</p>
        <p className="mt-1">Each sender gets a six-digit code from the setup wizard and texts it back to link their phone or chat.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="inbound-stack-table w-full text-left text-sm">
        <thead>
          <tr className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-500">
            <th className="py-2 pr-3 font-medium">Sender</th>
            <th className="py-2 pr-3 font-medium">Label</th>
            <th className="py-2 pr-3 font-medium">Org</th>
            <th className="py-2 pr-3 font-medium">Accounts</th>
            <th className="py-2 pr-3 font-medium">Mode</th>
            <th className="py-2 pr-3 font-medium">Confirm</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {bindings.map((b) => (
            <tr key={b.id} className="border-b border-ink-100 last:border-0" data-testid="inbound-binding-row" data-status={b.status}>
              <td className="cell-from py-2.5 pr-3 text-ink-800">
                <span className="text-xs text-ink-400">{CHANNEL_SHORT_LABEL[b.channel]}</span> {maskSenderId(b.senderId)}
              </td>
              <td className="cell-label py-2.5 pr-3 text-ink-600" data-label="Label">{b.senderLabel || <span className="text-ink-400">No label</span>}</td>
              <td className="cell-meta cell-org py-2.5 pr-3 text-ink-600" data-label="Org">{orgName(b.orgId)}</td>
              <td className="cell-meta cell-accounts py-2.5 pr-3 text-ink-600" data-label="Accounts">{accountLabel(b.connectionIds)}</td>
              <td className="cell-meta cell-mode py-2.5 pr-3 text-ink-600" data-label="Mode">{b.publishMode === "queue" ? "Queue" : "All at once"}</td>
              <td className="cell-meta cell-confirm py-2.5 pr-3 text-ink-600" data-label="Confirm">{b.confirmBeforePosting ? "Yes" : "No"}</td>
              <td className="cell-status py-2.5 pr-3">
                <Badge tone={STATUS_TONE[b.status]} dot>{STATUS_LABEL[b.status]}</Badge>
              </td>
              <td className="cell-toggle py-2.5 text-right">
                {b.status === "revoked" ? (
                  <Button variant="ghost" size="xs" className="inbound-tap" onClick={() => relink(b.id, b.channel)} disabled={remove.isPending} aria-label={`Re-link ${b.senderLabel || maskSenderId(b.senderId)}`}>Re-link</Button>
                ) : (
                  <Button variant="ghost" size="xs" className="inbound-tap text-red-600 hover:bg-red-50" onClick={() => revoke(b.id)} disabled={update.isPending} aria-label={`Revoke ${b.senderLabel || maskSenderId(b.senderId)}`}>Revoke</Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
