import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Eye, EyeOff } from "lucide-react";
import {
  FORMAT_SPECS,
  PLATFORM_SPECS,
  type ConnectionMode,
  type ConnectionSettings,
  type PlatformConnection,
  type PostFormat,
} from "@socmedia/shared";
import { Badge, Button, Card, Field, Input, PlatformIcon, SegmentedTabs, Select } from "@/components/ui";
import { cn, relativeTime } from "@/lib/utils";
import type { useConnectionMutations } from "@/hooks/useConnections";

interface Props {
  connection: PlatformConnection;
  mutations: ReturnType<typeof useConnectionMutations>;
  onBack: () => void;
  siblingCount?: number;
}

interface FormState {
  label: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  mode: ConnectionMode;
  settings: ConnectionSettings;
  organizationId: string;
}

function deriveForm(connection: PlatformConnection): FormState {
  return {
    label: connection.label ?? "",
    clientId: connection.credentials.clientId ?? "",
    clientSecret: connection.credentials.clientSecret ?? "",
    redirectUri: connection.credentials.redirectUri ?? "",
    scopes: connection.credentials.scopes ?? [],
    mode: connection.mode,
    settings: { ...connection.settings },
    organizationId: connection.credentials.extra?.organizationId ?? "",
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

function CheckboxRow({ label, checked, onChange, id }: { label: string; checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 px-3 py-2 text-sm cursor-pointer hover:bg-ink-50">
      <span className="text-ink-700">{label}</span>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-200" />
    </label>
  );
}

export function ConnectionCardBack({ connection, mutations, onBack, siblingCount = 1 }: Props) {
  const spec = PLATFORM_SPECS[connection.platform];
  const { update, refresh, remove } = mutations;
  const [form, setForm] = useState<FormState>(() => deriveForm(connection));
  const [showSecret, setShowSecret] = useState(false);

  // Reset local form state whenever the underlying connection is replaced (e.g. after a save).
  useEffect(() => {
    setForm(deriveForm(connection));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id, connection.updatedAt]);

  const initial = useMemo(() => deriveForm(connection), [connection.id, connection.updatedAt]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const fid = (name: string) => `${connection.id}-${name}`;
  const suggestedRedirect = typeof window !== "undefined" ? `${window.location.origin}/api/connections/oauth/callback` : "/api/connections/oauth/callback";

  const toggleScope = (scope: string) => {
    setForm((f) => ({ ...f, scopes: f.scopes.includes(scope) ? f.scopes.filter((s) => s !== scope) : [...f.scopes, scope] }));
  };

  const updateSetting = <K extends keyof ConnectionSettings>(key: K, value: ConnectionSettings[K]) => {
    setForm((f) => ({ ...f, settings: { ...f.settings, [key]: value } }));
  };

  const copyRedirect = async () => {
    try {
      await navigator.clipboard?.writeText(suggestedRedirect);
      toast.success("Redirect URI copied");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const handleSave = () => {
    const extra: Record<string, string> = { ...connection.credentials.extra };
    if (connection.platform === "linkedin") extra.organizationId = form.organizationId;
    update.mutate(
      {
        id: connection.id,
        input: {
          label: form.label,
          mode: form.mode,
          credentials: {
            clientId: form.clientId,
            clientSecret: form.clientSecret,
            redirectUri: form.redirectUri,
            scopes: form.scopes,
            extra,
          },
          settings: form.settings,
        },
      },
      {
        onSuccess: () => toast.success(`${spec.name} settings saved`),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  const handleRefreshToken = () => {
    refresh.mutate(connection.id, {
      onSuccess: () => toast.success("Token refreshed"),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <PlatformIcon platform={connection.platform} size={28} />
          <h3 className="truncate text-sm font-semibold text-ink-900">Configure {spec.name}</h3>
          {dirty && <Badge tone="warning">Unsaved</Badge>}
        </div>
        <button type="button" onClick={onBack} className="shrink-0 text-xs font-medium text-ink-500 hover:text-ink-800">Back</button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto scrollbar-thin px-5 py-4 text-sm">
        <section className="space-y-3">
          <h4 className="label">Account</h4>
          <Field label="Label" htmlFor={fid("label")} hint="Shown next to the platform name so you can tell accounts apart.">
            <Input id={fid("label")} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="Main, Founder, EU…" />
          </Field>
        </section>
        <section className="space-y-3">
          <h4 className="label">API credentials</h4>
          <Field label="Client ID" htmlFor={fid("client-id")}>
            <Input id={fid("client-id")} value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))} placeholder="Client ID" />
          </Field>
          <Field label="Client secret" htmlFor={fid("client-secret")}>
            <div className="relative">
              <Input
                id={fid("client-secret")}
                type={showSecret ? "text" : "password"}
                value={form.clientSecret}
                onChange={(e) => setForm((f) => ({ ...f, clientSecret: e.target.value }))}
                placeholder="Client secret"
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowSecret((s) => !s)}
                aria-label={showSecret ? "Hide client secret" : "Show client secret"}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Field
            label="Redirect URI"
            htmlFor={fid("redirect-uri")}
            hint={
              connection.platform === "x"
                ? `Suggested: ${suggestedRedirect}. Register the app as a "Web App" in the X developer portal; X signs in with OAuth 2.0 and PKCE.`
                : `Suggested: ${suggestedRedirect}`
            }
          >
            <div className="flex items-center gap-2">
              <Input id={fid("redirect-uri")} value={form.redirectUri} onChange={(e) => setForm((f) => ({ ...f, redirectUri: e.target.value }))} placeholder={suggestedRedirect} />
              <Button type="button" variant="outline" size="sm" onClick={copyRedirect} aria-label="Copy suggested redirect URI">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </Field>
          <div>
            <p className="label mb-1.5">Scopes</p>
            <div className="flex flex-wrap gap-1.5">
              {spec.oauth.scopes.map((scope) => {
                const checked = form.scopes.includes(scope);
                return (
                  <label
                    key={scope}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
                      checked ? "border-brand-300 bg-brand-50 text-brand-700" : "border-ink-200 text-ink-500",
                    )}
                  >
                    <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleScope(scope)} aria-label={scope} />
                    {scope}
                  </label>
                );
              })}
            </div>
          </div>
          <a href={spec.oauth.docsUrl} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-xs">
            {spec.name} API docs <ExternalLink className="h-3 w-3" />
          </a>
        </section>

        <section className="space-y-2">
          <h4 className="label">Mode</h4>
          <SegmentedTabs
            items={[{ id: "sandbox", label: "Sandbox" }, { id: "live", label: "Live" }]}
            value={form.mode}
            onChange={(v) => setForm((f) => ({ ...f, mode: v as ConnectionMode }))}
          />
          <p className="text-xs text-ink-500">
            {form.mode === "sandbox"
              ? "Sandbox simulates publishing and connecting without calling the real API, safe for testing."
              : "Live mode calls the real platform API using the credentials above."}
          </p>
        </section>

        <section className="space-y-3">
          <h4 className="label">Default post settings</h4>
          <Field label="Default format" htmlFor={fid("format")}>
            <Select id={fid("format")} value={form.settings.defaultFormat} onChange={(e) => updateSetting("defaultFormat", e.target.value as PostFormat)}>
              {spec.formats.map((f) => (
                <option key={f} value={f}>{FORMAT_SPECS[f].label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Privacy" htmlFor={fid("privacy")}>
            <Select id={fid("privacy")} value={form.settings.privacy} onChange={(e) => updateSetting("privacy", e.target.value as ConnectionSettings["privacy"])}>
              <option value="public">Public</option>
              <option value="private">Private</option>
              <option value="unlisted">Unlisted</option>
              <option value="friends">Friends</option>
            </Select>
          </Field>
          <CheckboxRow id={fid("auto-hashtags")} label="Auto-generate hashtags" checked={form.settings.autoHashtags} onChange={(v) => updateSetting("autoHashtags", v)} />
          <CheckboxRow id={fid("allow-comments")} label="Allow comments" checked={form.settings.allowComments} onChange={(v) => updateSetting("allowComments", v)} />

          {connection.platform === "instagram" && (
            <>
              <CheckboxRow id={fid("first-comment")} label="Post hashtags as first comment" checked={form.settings.firstCommentHashtags} onChange={(v) => updateSetting("firstCommentHashtags", v)} />
              <CheckboxRow id={fid("share-to-feed")} label="Share reels to feed" checked={form.settings.shareToFeed} onChange={(v) => updateSetting("shareToFeed", v)} />
              {connection.credentials.extra?.igUserId && (
                <Field label="Instagram business account ID" htmlFor={fid("ig-user-id")}>
                  <Input id={fid("ig-user-id")} value={connection.credentials.extra.igUserId} readOnly disabled />
                </Field>
              )}
            </>
          )}

          {connection.platform === "tiktok" && (
            <>
              <CheckboxRow id={fid("allow-duet")} label="Allow duet" checked={form.settings.allowDuet} onChange={(v) => updateSetting("allowDuet", v)} />
              <CheckboxRow id={fid("allow-stitch")} label="Allow stitch" checked={form.settings.allowStitch} onChange={(v) => updateSetting("allowStitch", v)} />
            </>
          )}

          {connection.platform === "youtube" && (
            <>
              <CheckboxRow id={fid("made-for-kids")} label="Made for kids" checked={form.settings.madeForKids} onChange={(v) => updateSetting("madeForKids", v)} />
              <Field label="Category" htmlFor={fid("category")}>
                <Input id={fid("category")} value={form.settings.category} onChange={(e) => updateSetting("category", e.target.value)} placeholder="e.g. 22 (People & Blogs)" />
              </Field>
            </>
          )}

          {connection.platform === "linkedin" && (
            <>
              <CheckboxRow id={fid("post-as-org")} label="Post as organization" checked={form.settings.postAsOrganization} onChange={(v) => updateSetting("postAsOrganization", v)} />
              {form.settings.postAsOrganization && (
                <Field label="Organization ID" htmlFor={fid("organization-id")}>
                  <Input id={fid("organization-id")} value={form.organizationId} onChange={(e) => setForm((f) => ({ ...f, organizationId: e.target.value }))} placeholder="urn:li:organization:..." />
                </Field>
              )}
            </>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="label">Token status</h4>
          <div className="space-y-1 rounded-lg border border-ink-100 bg-ink-50 p-3 text-xs">
            <div className="flex justify-between gap-2"><span className="text-ink-500">Access token</span><span className="truncate font-mono">{connection.credentials.accessToken || "None"}</span></div>
            <div className="flex justify-between gap-2"><span className="text-ink-500">Expires</span><span>{connection.credentials.tokenExpiresAt ? relativeTime(connection.credentials.tokenExpiresAt) : "None"}</span></div>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefreshToken} loading={refresh.isPending} disabled={!connection.credentials.accessToken}>
            Refresh token
          </Button>
        </section>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-ink-100 bg-ink-50 px-5 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>Back</Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-700"
            disabled={siblingCount <= 1 || remove.isPending}
            title={siblingCount <= 1 ? "Keep at least one account per platform" : "Remove this account"}
            onClick={() => { if (window.confirm(`Remove this ${spec.name} account? Posts targeting it will lose that target.`)) remove.mutate(connection.id, { onSuccess: () => toast.message("Account removed"), onError: (e) => toast.error(errorMessage(e)) }); }}
          >
            Remove account
          </Button>
        </div>
        <Button size="sm" onClick={handleSave} loading={update.isPending} disabled={!dirty || update.isPending}>Save changes</Button>
      </div>
    </Card>
  );
}
