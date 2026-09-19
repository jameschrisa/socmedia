import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import type { Organization, OrganizationInput } from "@socmedia/shared";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { OrgLogo } from "@/components/ui/OrgLogo";
import { slugify } from "@/lib/utils";
import { timezoneOptions } from "./timezones";

export interface OrgFormValues {
  name: string;
  brandColor: string;
  timezone: string;
}

function valuesFor(org: Organization | null): OrgFormValues {
  if (!org) return { name: "", brandColor: "#7C5CFC", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" };
  return { name: org.name, brandColor: org.brandColor, timezone: org.timezone };
}

const LOGO_ACCEPT = "image/svg+xml,image/png,image/jpeg,image/webp";
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

interface Props {
  open: boolean;
  org: Organization | null; // null = create mode
  pending?: boolean;
  onClose: () => void;
  /** `logo` is a new file to upload, "remove" to clear the existing logo, or null for no change. */
  onSubmit: (input: OrganizationInput, logo: File | "remove" | null) => void;
}

/** Shared create/edit modal for organizations, including logo upload. */
export function OrgFormModal({ open, org, pending, onClose, onSubmit }: Props) {
  const [values, setValues] = useState<OrgFormValues>(() => valuesFor(org));
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const zones = timezoneOptions();

  useEffect(() => {
    if (open) {
      setValues(valuesFor(org));
      setLogoFile(null);
      setRemoveLogo(false);
      setLogoError(null);
      setLogoPreview(null);
    }
  }, [open, org]);

  useEffect(() => {
    if (!logoFile) return;
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_ACCEPT.split(",").includes(file.type)) { setLogoError("Use an SVG, PNG, JPEG or WebP file."); return; }
    if (file.size > LOGO_MAX_BYTES) { setLogoError("Logos must be under 2 MB."); return; }
    setLogoError(null);
    setRemoveLogo(false);
    setLogoFile(file);
  };

  const submit = () => {
    if (!values.name.trim()) return;
    onSubmit(
      { name: values.name.trim(), slug: slugify(values.name), brandColor: values.brandColor, timezone: values.timezone },
      logoFile ?? (removeLogo ? "remove" : null),
    );
  };

  const previewOrg = { name: values.name || "Org", brandColor: values.brandColor, logoUrl: logoPreview ?? (removeLogo ? null : org?.logoUrl ?? null) };
  const hasLogo = !!previewOrg.logoUrl;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={org ? "Edit organization" : "New organization"}
      description={org ? "Update the workspace name, logo, brand colour and timezone." : "Creates a fresh workspace with four sandbox connections ready to go."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={pending} disabled={!values.name.trim()}>{org ? "Save" : "Create"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Logo" hint={logoError ?? "SVG, PNG, JPEG or WebP up to 2 MB. Shown in the organization switcher and on brand badges."} error={logoError}>
          <div className="flex items-center gap-4">
            <OrgLogo org={previewOrg} size={64} rounded="rounded-none" />
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept={LOGO_ACCEPT} className="hidden" data-testid="org-logo-input" onChange={(e) => pickLogo(e.target.files?.[0])} />
              <Button variant="outline" size="sm" icon={<ImagePlus className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>{hasLogo ? "Replace logo" : "Upload logo"}</Button>
              {hasLogo && (
                <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => { setLogoFile(null); setLogoPreview(null); setRemoveLogo(true); }}>Remove</Button>
              )}
            </div>
          </div>
          {logoFile && <p className="mt-1 text-xs text-ink-500">Selected: {logoFile.name} ({Math.round(logoFile.size / 1024)} KB)</p>}
        </Field>
        <Field label="Name" htmlFor="org-form-name">
          <Input id="org-form-name" autoFocus value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} placeholder="Acme Wealth" />
        </Field>
        <Field label="Brand colour" htmlFor="org-form-color">
          <div className="flex items-center gap-3">
            <input
              id="org-form-color"
              type="color"
              value={values.brandColor}
              onChange={(e) => setValues((v) => ({ ...v, brandColor: e.target.value.toUpperCase() }))}
              className="h-9 w-12 rounded-md border border-ink-200 bg-glass p-1"
            />
            <Input value={values.brandColor} onChange={(e) => setValues((v) => ({ ...v, brandColor: e.target.value }))} className="w-32 font-mono" />
          </div>
        </Field>
        <Field label="Timezone" htmlFor="org-form-timezone">
          <Select id="org-form-timezone" value={values.timezone} onChange={(e) => setValues((v) => ({ ...v, timezone: e.target.value }))}>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
