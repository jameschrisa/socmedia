import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Organization, OrganizationInput } from "@socmedia/shared";
import { Badge, Button, Card, Modal, OrgLogo, SectionTitle, SegmentedTabs } from "@/components/ui";
import { useAppStore, type ThemePref } from "@/store/appStore";
import { useOrgMutations, useOrgs } from "@/hooks/useOrg";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { OrgFormModal } from "./OrgFormModal";
import { AiProviderSettings } from "./AiProviderSettings";
import { PublishingSettingsCard } from "./PublishingSettingsCard";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

function OrgRow({ org, current, onSelect, onEdit, onDelete, deletable }: {
  org: Organization;
  current: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deletable: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-3 transition",
        current ? "border-brand-300 bg-brand-50" : "border-ink-200 hover:border-ink-300",
      )}
    >
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <OrgLogo org={org} size={32} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-ink-900">{org.name}</span>
            {current && <Badge tone="brand">Current</Badge>}
          </span>
          <span className="block truncate text-xs text-ink-500">/{org.slug} · {org.timezone}</span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="xs" onClick={onEdit} aria-label={`Edit ${org.name}`}><Pencil className="h-3.5 w-3.5" /></Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={onDelete}
          disabled={!deletable}
          aria-label={`Delete ${org.name}`}
          title={deletable ? undefined : "Can't delete the last organization"}
        >
          <Trash2 className="h-3.5 w-3.5 text-red-500" />
        </Button>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { orgs, currentOrg, currentOrgId, setCurrentOrgId, isLoading } = useOrgs();
  const { create, update, remove, uploadLogo, removeLogo } = useOrgMutations();

  const [formOpen, setFormOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Organization | null>(null);

  const openCreate = () => { setEditingOrg(null); setFormOpen(true); };
  const openEdit = (org: Organization) => { setEditingOrg(org); setFormOpen(true); };

  /** Apply a pending logo change (new file or removal) after the org itself is saved. */
  const applyLogo = async (orgId: string, logo: File | "remove" | null) => {
    if (logo === "remove") await removeLogo.mutateAsync(orgId);
    else if (logo) await uploadLogo.mutateAsync({ id: orgId, file: logo });
  };

  const submitForm = (input: OrganizationInput, logo: File | "remove" | null) => {
    if (editingOrg) {
      update.mutate(
        { id: editingOrg.id, input },
        {
          onSuccess: async () => {
            try { await applyLogo(editingOrg.id, logo); toast.success(`${input.name} updated`); setFormOpen(false); }
            catch (e) { toast.error(`Saved, but the logo failed: ${errorMessage(e)}`); }
          },
          onError: (e) => toast.error(errorMessage(e)),
        },
      );
    } else {
      create.mutate(input, {
        onSuccess: async (org) => {
          try { await applyLogo(org.id, logo); toast.success(`${org.name} created`); setFormOpen(false); }
          catch (e) { toast.error(`Created, but the logo failed: ${errorMessage(e)}`); }
        },
        onError: (e) => toast.error(errorMessage(e)),
      });
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    remove.mutate(deleteTarget.id, {
      onSuccess: () => { toast.success(`${deleteTarget.name} deleted`); setDeleteTarget(null); },
      onError: (e) => {
        if (e instanceof ApiError && e.status === 409) toast.error("Can't delete the last organization");
        else toast.error(errorMessage(e));
      },
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Settings</h1>
        <p className="mt-1 text-sm text-ink-500">Manage organizations and review how suprstar publishes on your behalf.</p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SectionTitle>Organizations</SectionTitle>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>New organization</Button>
        </div>
        <Card className="p-3">
          {isLoading ? (
            <p className="p-3 text-sm text-ink-500">Loading organizations…</p>
          ) : orgs.length === 0 ? (
            <p className="p-3 text-sm text-ink-500">No organizations yet.</p>
          ) : (
            <div className="space-y-2">
              {orgs.map((org) => (
                <OrgRow
                  key={org.id}
                  org={org}
                  current={org.id === currentOrgId}
                  onSelect={() => setCurrentOrgId(org.id)}
                  onEdit={() => openEdit(org)}
                  onDelete={() => setDeleteTarget(org)}
                  deletable={orgs.length > 1}
                />
              ))}
            </div>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle>AI providers</SectionTitle>
        <AiProviderSettings />
      </section>

      <section className="space-y-3">
        <SectionTitle>Publishing accounts</SectionTitle>
        <PublishingSettingsCard />
      </section>

      <section className="space-y-3">
        <SectionTitle>Appearance</SectionTitle>
        <AppearanceCard />
      </section>

      <section className="space-y-3">
        <SectionTitle>Workspace</SectionTitle>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-ink-900">Sandbox vs. Live</h3>
            <p className="mt-2 text-sm text-ink-500">
              Sandbox mode simulates connecting, testing and publishing so you can build flows safely. Live mode calls the
              real platform APIs with your stored credentials. Switch it per connection from Social Profiles, then Configure.
            </p>
          </Card>
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-ink-900">Scheduler</h3>
            <p className="mt-2 text-sm text-ink-500">
              A background job checks for posts whose scheduled time has arrived and publishes them automatically. It runs
              continuously on the server, so there is nothing to configure here.
            </p>
          </Card>
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-red-700">Danger zone</h3>
            <p className="mt-2 text-sm text-ink-500">
              Deleting an organization removes its connections, media and posts. This can't be undone.
            </p>
            <Button
              variant="danger"
              size="sm"
              className="mt-3"
              onClick={() => currentOrg && setDeleteTarget(currentOrg)}
              disabled={!currentOrg || orgs.length <= 1}
            >
              Delete {currentOrg ? `"${currentOrg.name}"` : "current organization"}
            </Button>
          </Card>
        </div>
      </section>

      <OrgFormModal
        open={formOpen}
        org={editingOrg}
        pending={editingOrg ? update.isPending || uploadLogo.isPending || removeLogo.isPending : create.isPending || uploadLogo.isPending}
        onClose={() => setFormOpen(false)}
        onSubmit={submitForm}
      />

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete organization?"
        description={deleteTarget ? `This permanently removes "${deleteTarget.name}" and everything in it.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} loading={remove.isPending}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-ink-500">Connections, media and posts for this organization will be permanently deleted.</p>
      </Modal>
    </div>
  );
}

function AppearanceCard() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  return (
    <Card className="p-5 flex flex-wrap items-center justify-between gap-4" data-testid="appearance-card">
      <div>
        <h3 className="text-sm font-semibold text-ink-900">Theme</h3>
        <p className="mt-1 text-sm text-ink-500">Dark glass is the default. Light mode keeps the same frosted panels on a pale ground. System follows your OS setting.</p>
      </div>
      <SegmentedTabs<ThemePref>
        size="md"
        value={theme}
        onChange={setTheme}
        items={[{ id: "dark", label: "Dark" }, { id: "light", label: "Light" }, { id: "system", label: "System" }]}
      />
    </Card>
  );
}
