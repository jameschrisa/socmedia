import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Copy, Plus, QrCode, Smartphone, Trash2 } from "lucide-react";
import { PLATFORM_SPECS, type Platform, type PlatformConnection, type PublishMode, type QuickPostToken } from "@socmedia/shared";
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Modal, SegmentedTabs, Toggle } from "@/components/ui";
import { PlatformIcon } from "@/components/ui/PlatformIcon";
import { useConnections } from "@/hooks/useConnections";
import { useQuickTokenMutations, useQuickTokens } from "@/hooks/useQuickPost";
import { ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/utils";

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong";
}

/** A readable name for an account even when it has no nickname or profile name yet (fresh sandbox connections). */
function connectionName(c: PlatformConnection): string {
  return c.label || c.displayName || c.handle || `${PLATFORM_SPECS[c.platform].name} account`;
}

function TokenRow({ token, accountLabels, onToggle, onRevoke, busy }: {
  token: QuickPostToken;
  accountLabels: string;
  onToggle: (active: boolean) => void;
  onRevoke: () => void;
  busy: boolean;
}) {
  return (
    <tr className="border-b border-ink-100 last:border-0">
      <td className="py-2.5 pr-3 text-sm font-medium text-ink-900">{token.label}</td>
      <td className="py-2.5 pr-3 text-sm text-ink-600">{accountLabels}</td>
      <td className="py-2.5 pr-3 text-sm text-ink-600">{token.publishMode === "queue" ? "Queue" : "All at once"}</td>
      <td className="py-2.5 pr-3 text-sm text-ink-600">{token.usesCount}</td>
      <td className="py-2.5 pr-3 text-sm text-ink-600">{token.lastUsedAt ? relativeTime(token.lastUsedAt) : "Never"}</td>
      <td className="py-2.5 pr-3"><Toggle checked={token.active} onChange={onToggle} disabled={busy} label={`${token.label} active`} size="sm" /></td>
      <td className="py-2.5 text-right">
        <Button variant="ghost" size="sm" onClick={onRevoke} disabled={busy} aria-label={`Revoke ${token.label}`} className="text-red-600 hover:bg-red-50" icon={<Trash2 className="h-3.5 w-3.5" />}>
          <span className="hidden sm:inline">Revoke</span>
        </Button>
      </td>
    </tr>
  );
}

function CreateLinkModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: connections = [] } = useConnections();
  const { create } = useQuickTokenMutations();
  const [label, setLabel] = useState("");
  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  const [publishMode, setPublishMode] = useState<PublishMode>("all");
  const [created, setCreated] = useState<QuickPostToken | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const grouped = useMemo(() => {
    const byPlatform = new Map<Platform, typeof connections>();
    for (const c of connections) {
      const list = byPlatform.get(c.platform) ?? [];
      list.push(c);
      byPlatform.set(c.platform, list);
    }
    return Array.from(byPlatform.entries());
  }, [connections]);

  const url = created ? `${window.location.origin}/go/${created.token}` : "";

  useEffect(() => {
    if (!created?.token) { setQrDataUrl(null); return; }
    let cancelled = false;
    QRCode.toDataURL(url, { width: 220, margin: 1 }).then((dataUrl) => { if (!cancelled) setQrDataUrl(dataUrl); }).catch(() => {});
    return () => { cancelled = true; };
  }, [created, url]);

  const reset = () => {
    setLabel(""); setConnectionIds([]); setPublishMode("all"); setCreated(null); setQrDataUrl(null); setCopied(false);
    create.reset();
  };
  const close = () => { onClose(); reset(); };

  const toggleConnection = (id: string) => {
    setConnectionIds((old) => (old.includes(id) ? old.filter((c) => c !== id) : [...old, id]));
  };

  const submit = () => {
    if (!label.trim()) return;
    create.mutate({ label: label.trim(), connectionIds, publishMode }, {
      onSuccess: (token) => setCreated(token),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  if (created) {
    return (
      <Modal open={open} onClose={close} title="Link created" description="This is the only time the full link is shown. Save it now.">
        <div className="space-y-4">
          <div className="notice-warning">Copy this link or scan the QR code now. For security, suprstar won't show the full token again.</div>
          <Field label="Quick post link">
            <div className="flex items-center gap-2">
              <Input readOnly value={url} data-testid="quick-link-url" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button type="button" size="md" className="shrink-0" icon={<Copy className="h-3.5 w-3.5" />} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
            </div>
          </Field>
          <div className="flex justify-center">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt={`QR code for ${url}`} width={180} height={180} data-testid="quick-link-qr" />
            ) : (
              <div className="flex h-[180px] w-[180px] items-center justify-center bg-ink-50 text-ink-400"><QrCode className="h-8 w-8" /></div>
            )}
          </div>
          <div className="notice-info">
            <p className="font-medium text-ink-700">iOS Shortcut</p>
            <p className="mt-1">Use a Shortcuts "Get Contents of URL" step with method POST and a form-multipart body:</p>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all bg-ink-100 p-2 text-[11px]">{`curl -F "image=@IMG_0001.jpg" -F "caption=Your caption" "${window.location.origin}/api/quick/${created.token}"`}</pre>
          </div>
        </div>
        <div className="mt-5 flex justify-end"><Button variant="outline" onClick={close}>Done</Button></div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={close} title="Create link" description="Anyone with this link can post a photo to the accounts you choose, until you revoke it.">
      <div className="space-y-4">
        <Field label="Label" htmlFor="quick-label" hint="Helps you tell links apart later, e.g. “Front desk iPad”.">
          <Input id="quick-label" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </Field>
        <Field label="Accounts" hint="Leave all unchecked to post to every enabled account.">
          <div className="space-y-3">
            {grouped.map(([platform, conns]) => (
              <div key={platform}>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <PlatformIcon platform={platform} size={16} /> {PLATFORM_SPECS[platform].name}
                </div>
                <div className="-mx-2 space-y-0.5">
                  {conns.map((c) => (
                    <label key={c.id} className="flex min-h-9 cursor-pointer items-center gap-2.5 px-2 text-sm text-ink-700 hover:bg-ink-50">
                      <input type="checkbox" className="control-accent h-4 w-4" checked={connectionIds.includes(c.id)} onChange={() => toggleConnection(c.id)} />
                      {connectionName(c)}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {grouped.length === 0 && <p className="text-sm text-ink-500">No accounts connected yet. The link will post to any account you connect later.</p>}
          </div>
        </Field>
        <Field label="Publish mode">
          <SegmentedTabs<PublishMode>
            value={publishMode}
            onChange={setPublishMode}
            items={[{ id: "all", label: "All at once" }, { id: "queue", label: "Queue" }]}
          />
        </Field>
        {create.isError && <p className="notice-danger" role="alert">{errorMessage(create.error)}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button onClick={submit} loading={create.isPending} disabled={!label.trim()}>Create link</Button>
      </div>
    </Modal>
  );
}

/** Settings section: manage "Quick post from your phone" links (advanced, write access only). */
export function QuickPostSection() {
  const { data: tokens = [], isLoading } = useQuickTokens();
  const { data: connections = [] } = useConnections();
  const { update, remove } = useQuickTokenMutations();
  const [modalOpen, setModalOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<QuickPostToken | null>(null);

  const accountLabelsFor = (token: QuickPostToken) => {
    if (token.connectionIds.length === 0) return "All enabled accounts";
    const labels = token.connectionIds
      .map((id) => connections.find((c) => c.id === id))
      .filter(Boolean)
      .map((c) => connectionName(c!));
    return labels.length ? labels.join(", ") : `${token.connectionIds.length} account(s)`;
  };

  return (
    <Card>
      <CardHeader
        title="Quick post from your phone"
        subtitle={
          <>
            <Badge tone="info" className="mr-2">Advanced</Badge>
            Open the link on your phone, snap a photo, type a caption or record a voice memo. It posts immediately to the
            chosen accounts and shows the live links.
          </>
        }
        action={<Button size="sm" className="shrink-0 whitespace-nowrap" icon={<Plus className="h-4 w-4" />} onClick={() => setModalOpen(true)}>Create link</Button>}
      />
      <CardBody>
        {isLoading ? (
          <div className="space-y-2 py-1" aria-busy="true" aria-label="Loading links">
            <div className="h-4 w-1/3 animate-pulse bg-ink-100" />
            <div className="h-4 w-2/3 animate-pulse bg-ink-100" />
          </div>
        ) : tokens.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center bg-brand-50 text-brand-600"><Smartphone className="h-5 w-5" aria-hidden /></span>
            <div className="space-y-1">
              <p className="text-sm font-medium text-ink-800">No quick post links yet</p>
              <p className="max-w-sm text-sm text-ink-500">Each link is a page you open on a phone. Snap, caption, post. Revoke it here whenever you like.</p>
            </div>
            <Button variant="outline" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setModalOpen(true)}>Create your first link</Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-3 font-medium">Label</th>
                  <th className="py-2 pr-3 font-medium">Accounts</th>
                  <th className="py-2 pr-3 font-medium">Mode</th>
                  <th className="py-2 pr-3 font-medium">Uses</th>
                  <th className="py-2 pr-3 font-medium">Last used</th>
                  <th className="py-2 pr-3 font-medium">Active</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <TokenRow
                    key={token.id}
                    token={token}
                    accountLabels={accountLabelsFor(token)}
                    busy={update.isPending || remove.isPending}
                    onToggle={(active) => update.mutate({ id: token.id, input: { active } })}
                    onRevoke={() => setRevokeTarget(token)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>

      <CreateLinkModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <Modal
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        title="Revoke this link?"
        description={revokeTarget ? `"${revokeTarget.label}" will stop working immediately.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => revokeTarget && remove.mutate(revokeTarget.id, { onSuccess: () => setRevokeTarget(null) })}
            >
              Revoke
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-500">Anyone who still has this link will no longer be able to post with it.</p>
      </Modal>
    </Card>
  );
}
