import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import type { AccessPolicy, AllowedDomain, Organization, UserRole } from "@socmedia/shared";
import { Button, Card, CardBody, CardHeader, EmptyState, Input, Select, Skeleton } from "@/components/ui";
import { useOrgs } from "@/hooks/useOrg";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type InviteRole = Exclude<UserRole, "owner">;
const ROLE_LABEL: Record<InviteRole, string> = { admin: "Admin", editor: "Editor", viewer: "Viewer" };

/** Matches shared/src/schemas.ts domainSchema: lowercase, at least one dot, no @. */
const DOMAIN_RE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase();
}

function OrgSlugsChips({ orgs, value, onChange }: { orgs: Organization[]; value: string[] | "*"; onChange: (v: string[] | "*") => void }) {
  const isAll = value === "*";
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        className={cn("chip whitespace-nowrap", isAll ? "chip-active" : "chip-inactive")}
        onClick={() => onChange(isAll ? [] : "*")}
      >
        All organizations
      </button>
      {orgs.map((o) => {
        const active = !isAll && value.includes(o.slug);
        return (
          <button
            key={o.id}
            type="button"
            className={cn("chip whitespace-nowrap", active ? "chip-active" : "chip-inactive", isAll && "opacity-40")}
            disabled={isAll}
            onClick={() => {
              if (isAll) return;
              const set = new Set(value);
              if (set.has(o.slug)) set.delete(o.slug); else set.add(o.slug);
              onChange(Array.from(set));
            }}
          >
            {o.name}
          </button>
        );
      })}
    </div>
  );
}

function DomainRow({ domain, orgs, onChange, onRemove }: {
  domain: AllowedDomain;
  orgs: Organization[];
  onChange: (next: AllowedDomain) => void;
  onRemove: () => void;
}) {
  return (
    <tr className="border-b border-ink-100 last:border-0" data-testid={`domain-row-${domain.domain}`}>
      <td className="whitespace-nowrap px-5 py-3 font-mono text-sm text-ink-900">@{domain.domain}</td>
      <td className="px-5 py-3">
        <Select
          aria-label={`Role for ${domain.domain}`}
          className="min-w-[7.5rem]"
          value={domain.role}
          onChange={(e) => onChange({ ...domain, role: e.target.value as InviteRole })}
        >
          {(Object.keys(ROLE_LABEL) as InviteRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </Select>
      </td>
      <td className="px-5 py-3">
        <OrgSlugsChips orgs={orgs} value={domain.orgSlugs} onChange={(orgSlugs) => onChange({ ...domain, orgSlugs })} />
      </td>
      <td className="px-5 py-3 text-right">
        <Button variant="ghost" size="xs" className="text-red-600 hover:bg-red-50" onClick={onRemove} aria-label={`Remove ${domain.domain}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  );
}

/** Which domains may self-serve sign in (magic link / Google) and how those users get provisioned. */
export function SignInPolicyCard() {
  const qc = useQueryClient();
  const { orgs } = useOrgs();
  const policy = useQuery({ queryKey: qk.accessPolicy, queryFn: api.settings.getAccessPolicy });
  const [form, setForm] = useState<AccessPolicy | null>(null);
  useEffect(() => { if (policy.data && !form) setForm(policy.data); }, [policy.data, form]);

  const [newDomain, setNewDomain] = useState("");
  const [domainError, setDomainError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (input: AccessPolicy) => api.settings.updateAccessPolicy(input),
    onSuccess: (data) => { qc.setQueryData(qk.accessPolicy, data); setForm(data); toast.success("Sign-in policy saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const dirty = !!form && !!policy.data && JSON.stringify(form) !== JSON.stringify(policy.data);

  const addDomain = (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const domain = normalizeDomain(newDomain);
    if (!DOMAIN_RE.test(domain)) { setDomainError("Enter a domain like example.com"); return; }
    if (form.domains.some((d) => d.domain === domain)) { setDomainError("That domain is already listed"); return; }
    setForm({ ...form, domains: [...form.domains, { domain, role: "editor", orgSlugs: "*" }] });
    setNewDomain("");
    setDomainError(null);
  };

  const updateDomain = (index: number, next: AllowedDomain) => {
    if (!form) return;
    setForm({ ...form, domains: form.domains.map((d, i) => (i === index ? next : d)) });
  };

  const removeDomain = (index: number) => {
    if (!form) return;
    setForm({ ...form, domains: form.domains.filter((_, i) => i !== index) });
  };

  return (
    <Card data-testid="sign-in-policy-card">
      <CardHeader title="Sign-in policy" subtitle="Which email domains may sign themselves in, and what they get access to." />
      <CardBody className="space-y-4">
        {!form ? (
          <Skeleton className="h-32" />
        ) : (
          <>
            {form.domains.length === 0 ? (
              <EmptyState title="No allowed domains yet" description="Add a domain so its members can sign in with a link or Google without an invite." />
            ) : (
              <div className="overflow-x-auto border border-ink-100">
                <table className="w-full min-w-[44rem] text-sm" data-testid="allowed-domains-table">
                  <thead>
                    <tr className="border-b border-ink-100 text-left text-xs font-medium uppercase tracking-wide text-ink-500">
                      <th className="px-5 py-2">Domain</th>
                      <th className="px-5 py-2">Role</th>
                      <th className="px-5 py-2">Organizations</th>
                      <th className="px-5 py-2 text-right">Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.domains.map((d, i) => (
                      <DomainRow key={d.domain} domain={d} orgs={orgs} onChange={(next) => updateDomain(i, next)} onRemove={() => removeDomain(i)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <form onSubmit={addDomain} className="flex flex-wrap items-start gap-2">
              <div className="min-w-[200px] flex-1">
                <Input
                  aria-label="Add domain"
                  placeholder="example.com"
                  aria-invalid={domainError ? true : undefined}
                  value={newDomain}
                  onChange={(e) => { setNewDomain(e.target.value); setDomainError(null); }}
                />
                {domainError && <p className="mt-1 text-xs text-red-600" role="alert">{domainError}</p>}
              </div>
              <Button type="submit" variant="outline" size="md" icon={<Plus className="h-4 w-4" />} disabled={!newDomain}>Add domain</Button>
            </form>

            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                className="control-accent focus-ring"
                checked={form.allowInvitedUsersAnyDomain}
                onChange={(e) => setForm({ ...form, allowInvitedUsersAnyDomain: e.target.checked })}
              />
              Invited users may sign in with a link or Google even if their domain is not listed
            </label>

            <div className="flex items-center justify-end gap-3 border-t border-ink-100 pt-4">
              {dirty && <span className="text-xs text-ink-500">Unsaved changes</span>}
              <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => form && save.mutate(form)} data-testid="save-access-policy">
                Save
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
