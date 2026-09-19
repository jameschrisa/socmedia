import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronsUpDown, Plus, Building2 } from "lucide-react";
import { useOrgs, useOrgMutations } from "@/hooks/useOrg";
import { cn, slugify } from "@/lib/utils";
import { Button, Field, Input, Modal, OrgLogo, Portal, useAnchorPosition } from "@/components/ui";
import { toast } from "sonner";

export function OrgSwitcher() {
  const { orgs, currentOrg, setCurrentOrgId, isLoading } = useOrgs();
  const { create } = useOrgMutations();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#7C5CFC");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const MENU_W = 256;
  const pos = useAnchorPosition(triggerRef, open, { align: "right", offset: 8, width: MENU_W });

  const submit = async () => {
    if (!name.trim()) return;
    try {
      const org = await create.mutateAsync({ name: name.trim(), slug: slugify(name), brandColor: color, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
      toast.success(`Switched to ${org.name}`);
      setCreating(false); setName(""); setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="org-switcher"
        className="flex items-center gap-2.5 rounded-xl border border-ink-200 bg-glass px-2.5 py-1.5 text-left hover:border-ink-300 hover:shadow-card transition"
      >
        {currentOrg ? (
          <OrgLogo org={currentOrg} size={28} />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-white"><Building2 className="h-4 w-4" /></span>
        )}
        <span className="hidden sm:block">
          <span className="block text-xs text-ink-500 leading-none">Organization</span>
          <span className="block text-sm font-semibold leading-tight max-w-[160px] truncate">{isLoading ? "Loading…" : currentOrg?.name ?? "Select"}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 text-ink-400" />
      </button>

      <Portal>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
            <motion.ul
              role="listbox"
              initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_W }}
              className="z-[100] card glass-menu p-1.5 shadow-pop"
              data-testid="org-switcher-menu"
            >
              {orgs.map((org) => {
                const active = org.id === currentOrg?.id;
                return (
                  <li key={org.id}>
                    <button
                      role="option"
                      aria-selected={active}
                      onClick={() => { setCurrentOrgId(org.id); setOpen(false); toast.message(`Switched to ${org.name}`); }}
                      className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-ink-50", active && "bg-brand-50")}
                    >
                      <OrgLogo org={org} size={28} />
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium truncate">{org.name}</span>
                        <span className="block text-xs text-ink-500 truncate">{org.timezone}</span>
                      </span>
                      {active && <Check className="h-4 w-4 text-brand-600" />}
                    </button>
                  </li>
                );
              })}
              <li className="mt-1 border-t border-ink-100 pt-1">
                <button onClick={() => { setCreating(true); setOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-brand-700 hover:bg-brand-50">
                  <Plus className="h-4 w-4" /> New organization
                </button>
              </li>
            </motion.ul>
          </>
        )}
      </AnimatePresence>
      </Portal>

      <Modal open={creating} onClose={() => setCreating(false)} title="Create organization" description="Each organization has its own connected accounts, media and calendar."
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button onClick={submit} loading={create.isPending} disabled={!name.trim()}>Create</Button></>}>
        <div className="space-y-4">
          <Field label="Name" htmlFor="org-name"><Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Wealth" autoFocus /></Field>
          <Field label="Brand colour">
            <div className="flex items-center gap-3">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} className="h-9 w-12 rounded-md border border-ink-200 bg-glass p-1" aria-label="Brand colour" />
              <Input value={color} onChange={(e) => setColor(e.target.value)} className="w-32 font-mono" />
            </div>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
