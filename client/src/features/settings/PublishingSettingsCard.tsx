import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { PLATFORMS, PLATFORM_SPECS, type Platform, type PlatformConnection, type PublishingSettings } from "@socmedia/shared";
import { Badge, Button, Card, Input, Modal, PlatformIcon, SegmentedTabs, Skeleton, StatusBadge, Toggle } from "@/components/ui";
import { useConnectionMutations, useConnections } from "@/hooks/useConnections";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { AddAccountModal } from "@/features/connections/AddAccountModal";

function accountName(c: PlatformConnection): string {
  return c.label || c.displayName || "Account";
}

/** Workspace publishing defaults plus a per-platform overview of every account. */
export function PublishingSettingsCard() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: qk.publishing, queryFn: api.settings.getPublishing });
  const [form, setForm] = useState<PublishingSettings | null>(null);
  useEffect(() => { if (settings.data && !form) setForm(settings.data); }, [settings.data, form]);
  const save = useMutation({
    mutationFn: (input: PublishingSettings) => api.settings.updatePublishing(input),
    onSuccess: (data) => { qc.setQueryData(qk.publishing, data); setForm(data); toast.success("Publishing defaults saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: connections, isLoading } = useConnections();
  const { update, remove } = useConnectionMutations();
  const [adding, setAdding] = useState<Platform | null>(null);
  const [removing, setRemoving] = useState<PlatformConnection | null>(null);
  const dirty = !!form && !!settings.data && JSON.stringify(form) !== JSON.stringify(settings.data);

  const confirmRemove = () => {
    if (!removing) return;
    remove.mutate(removing.id, {
      onSuccess: () => { toast.success(`${accountName(removing)} removed`); setRemoving(null); },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove"),
    });
  };

  return (
    <div className="space-y-4" data-testid="publishing-settings">
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">Defaults for multi-account posts</h3>
          <p className="mt-1 text-sm text-ink-500">Applied to new posts that target more than one account. Each post can still override them in the composer.</p>
        </div>
        {!form ? <Skeleton className="h-16" /> : (
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <div className="space-y-1.5">
              <span id="publish-mode-label" className="block text-sm font-medium text-ink-700">Publish mode</span>
              <SegmentedTabs<PublishingSettings["defaultPublishMode"]>
                size="md"
                value={form.defaultPublishMode}
                onChange={(defaultPublishMode) => setForm({ ...form, defaultPublishMode })}
                items={[{ id: "all", label: "All at once" }, { id: "queue", label: "Queue" }]}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="publishing-queue-spacing" className="block text-sm font-medium text-ink-700">Queue spacing</label>
              <div className="flex h-9 items-center gap-2 text-sm text-ink-600">
                <Input
                  id="publishing-queue-spacing"
                  type="number"
                  min={1}
                  max={1440}
                  className="w-20"
                  aria-label="Default queue spacing minutes"
                  value={form.queueSpacingMinutes}
                  onChange={(e) => setForm({ ...form, queueSpacingMinutes: Math.max(1, Number(e.target.value) || 1) })}
                />
                minutes between accounts
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-ink-700">Duplicate captions</span>
              <label className="flex h-9 items-center gap-2 text-sm text-ink-600">
                <Toggle checked={form.warnOnDuplicateCaptions} onChange={(v) => setForm({ ...form, warnOnDuplicateCaptions: v })} label="Warn on duplicate captions" size="sm" />
                Warn when accounts share a caption
              </label>
            </div>
            <div className="ml-auto flex h-9 items-center gap-3">
              {dirty && <span className="text-xs text-ink-500">Unsaved changes</span>}
              <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => form && save.mutate(form)} data-testid="publishing-save">Save defaults</Button>
            </div>
          </div>
        )}
        <p className="text-xs text-ink-500">
          Networks throttle accounts that post identical content at the same moment, and they cap uploads per account (YouTube's daily quota, Instagram's 25 posts a day). Queue mode spaces accounts out. Every account publishes as its own job, so one failure never blocks the rest.
        </p>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Accounts by platform</h3>
            <p className="mt-1 text-sm text-ink-500">Enable or disable which accounts are offered when composing. Credentials and connection tests live in <Link className="link" to="/connections">Social Profiles</Link>.</p>
          </div>
        </div>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-busy="true" aria-label="Loading accounts">
            {PLATFORMS.map((p) => <Skeleton key={p} className="h-24" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {PLATFORMS.map((platform) => {
              const accounts = (connections ?? []).filter((c) => c.platform === platform);
              const spec = PLATFORM_SPECS[platform];
              return (
                <div key={platform} className="border border-ink-200 p-3 space-y-2" data-testid={`accounts-${platform}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <PlatformIcon platform={platform} size={24} />
                      <span className="text-sm font-medium text-ink-900">{spec.name}</span>
                      <Badge tone="neutral">{accounts.length}</Badge>
                    </div>
                    <Button variant="outline" size="xs" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(platform)} aria-label={`Add ${spec.name} account`}>Add</Button>
                  </div>
                  {accounts.length === 0 && <p className="text-xs text-ink-500">No {spec.name} accounts yet.</p>}
                  {accounts.map((c) => {
                    const name = accountName(c);
                    const last = accounts.length <= 1;
                    return (
                      <div key={c.id} className="flex min-h-[36px] items-center gap-2 text-sm">
                        <Toggle size="sm" checked={c.enabled} onChange={(enabled) => update.mutate({ id: c.id, input: { enabled } })} label={`Enable ${c.label || c.handle || c.id}`} />
                        <span className="min-w-0 flex-1 truncate">
                          <span className={c.enabled ? "font-medium text-ink-900" : "font-medium text-ink-500"}>{name}</span>
                          {c.status === "connected" && c.handle && <span className="ml-1 text-xs text-ink-500">{c.handle}</span>}
                        </span>
                        <StatusBadge status={c.status} />
                        {c.mode === "live" && <Badge tone="brand">Live</Badge>}
                        <button
                          type="button"
                          aria-label={`Remove ${c.label || c.handle || "account"}`}
                          className="focus-ring flex h-7 w-7 items-center justify-center text-ink-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-400"
                          disabled={last}
                          title={last ? "Keep at least one account per platform" : "Remove account"}
                          onClick={() => setRemoving(c)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {adding && <AddAccountModal open platform={adding} siblings={(connections ?? []).filter((c) => c.platform === adding)} onClose={() => setAdding(null)} />}
      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove account?"
        description={removing ? `This removes the ${PLATFORM_SPECS[removing.platform].name} account "${accountName(removing)}" and its tokens.` : undefined}
        size="sm"
        footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" onClick={confirmRemove} loading={remove.isPending}>Remove</Button></>}
      >
        <p className="text-sm text-ink-500">Disable the account instead if you only want to hide it from the composer. Removing can't be undone.</p>
      </Modal>
    </div>
  );
}
