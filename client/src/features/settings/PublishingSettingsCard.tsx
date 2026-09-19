import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { PLATFORMS, PLATFORM_SPECS, type Platform, type PublishingSettings } from "@socmedia/shared";
import { Badge, Button, Card, Input, PlatformIcon, SegmentedTabs, Skeleton, StatusBadge, Toggle } from "@/components/ui";
import { useConnectionMutations, useConnections } from "@/hooks/useConnections";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { AddAccountModal } from "@/features/connections/AddAccountModal";

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
  const dirty = !!form && !!settings.data && JSON.stringify(form) !== JSON.stringify(settings.data);

  return (
    <div className="space-y-4" data-testid="publishing-settings">
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">Defaults for multi-account posts</h3>
          <p className="mt-1 text-sm text-ink-500">Applied to new posts that target more than one account. Each post can still override them in the composer.</p>
        </div>
        {!form ? <Skeleton className="h-16" /> : (
          <div className="flex flex-wrap items-center gap-4">
            <SegmentedTabs<PublishingSettings["defaultPublishMode"]>
              size="md"
              value={form.defaultPublishMode}
              onChange={(defaultPublishMode) => setForm({ ...form, defaultPublishMode })}
              items={[{ id: "all", label: "All at once" }, { id: "queue", label: "Queue" }]}
            />
            <label className="flex items-center gap-2 text-sm text-ink-600">
              Queue spacing
              <Input type="number" min={1} max={1440} className="w-20" aria-label="Default queue spacing minutes" value={form.queueSpacingMinutes} onChange={(e) => setForm({ ...form, queueSpacingMinutes: Math.max(1, Number(e.target.value) || 1) })} />
              minutes
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-600">
              <Toggle checked={form.warnOnDuplicateCaptions} onChange={(v) => setForm({ ...form, warnOnDuplicateCaptions: v })} label="Warn on duplicate captions" size="sm" />
              Warn on identical captions
            </label>
            <Button size="sm" className="ml-auto" disabled={!dirty} loading={save.isPending} onClick={() => form && save.mutate(form)} data-testid="publishing-save">Save defaults</Button>
          </div>
        )}
        <p className="text-xs text-ink-500">
          Why it matters: the networks throttle accounts that post identical content at the same moment and rate-limit uploads per account (YouTube's daily quota, Instagram's 25 posts per day). Queue mode spaces accounts out, each account keeps its own tokens, and every account publishes as an isolated job so one failure never blocks the rest.
        </p>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Accounts by platform</h3>
            <p className="mt-1 text-sm text-ink-500">Enable or disable which accounts are offered when composing. Credentials and connection tests live in <Link className="link" to="/connections">Social Profiles</Link>.</p>
          </div>
        </div>
        {isLoading ? <Skeleton className="h-24" /> : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {PLATFORMS.map((platform) => {
              const accounts = (connections ?? []).filter((c) => c.platform === platform);
              return (
                <div key={platform} className="border border-ink-200 p-3 space-y-2" data-testid={`accounts-${platform}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <PlatformIcon platform={platform} size={24} />
                      <span className="text-sm font-medium text-ink-900">{PLATFORM_SPECS[platform].name}</span>
                      <span className="text-xs text-ink-500">{accounts.length}</span>
                    </div>
                    <Button variant="outline" size="xs" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(platform)} aria-label={`Add ${PLATFORM_SPECS[platform].name} account`}>Add</Button>
                  </div>
                  {accounts.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-sm">
                      <Toggle size="sm" checked={c.enabled} onChange={(enabled) => update.mutate({ id: c.id, input: { enabled } })} label={`Enable ${c.label || c.handle || c.id}`} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-ink-900">{c.label || c.displayName || "Account"}</span>
                        <span className="ml-1 text-xs text-ink-500">{c.status === "connected" ? c.handle : "not connected"}</span>
                      </span>
                      <StatusBadge status={c.status} />
                      {c.mode === "live" && <Badge tone="brand">Live</Badge>}
                      <button
                        type="button"
                        aria-label={`Remove ${c.label || c.handle || "account"}`}
                        className="text-ink-400 hover:text-red-600 disabled:opacity-30"
                        disabled={accounts.length <= 1}
                        title={accounts.length <= 1 ? "Keep at least one account per platform" : "Remove account"}
                        onClick={() => { if (window.confirm("Remove this account?")) remove.mutate(c.id, { onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove") }); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {adding && <AddAccountModal open platform={adding} siblings={(connections ?? []).filter((c) => c.platform === adding)} onClose={() => setAdding(null)} />}
    </div>
  );
}
