import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PLATFORM_SPECS, type Platform, type PlatformConnection } from "@socmedia/shared";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { useConnectionMutations } from "@/hooks/useConnections";

interface Props {
  open: boolean;
  platform: Platform;
  siblings: PlatformConnection[];
  onClose: () => void;
}

function siblingName(s: PlatformConnection): string {
  return s.label || s.handle || s.displayName || "existing account";
}

/** Adds another account on a platform, optionally copying app credentials from an existing one. */
export function AddAccountModal({ open, platform, siblings, onClose }: Props) {
  const { create } = useConnectionMutations();
  const spec = PLATFORM_SPECS[platform];
  const [label, setLabel] = useState("");
  const [copyFrom, setCopyFrom] = useState<string>(siblings[0]?.id ?? "");
  const [mode, setMode] = useState<"sandbox" | "live">(siblings[0]?.mode ?? "sandbox");
  const fallbackLabel = `Account ${siblings.length + 1}`;
  const source = siblings.find((s) => s.id === copyFrom);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (create.isPending) return;
    create.mutate(
      { platform, label: label.trim(), mode, copyCredentialsFrom: copyFrom || undefined },
      {
        onSuccess: (conn) => { toast.success(`${spec.name} account "${conn.label}" added. Connect it to finish.`); setLabel(""); onClose(); },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add account"),
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add ${spec.name} account`}
      description="Each account keeps its own tokens. App credentials can be shared with an account you already configured."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="add-account-form" loading={create.isPending} data-testid="add-account-submit">Add account</Button></>}
    >
      <form id="add-account-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Label" htmlFor="add-account-label" hint={`Tells accounts apart in the composer, e.g. Main, Founder, EU. Leave blank to use "${fallbackLabel}".`}>
          <Input id="add-account-label" autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder={fallbackLabel} maxLength={40} />
        </Field>
        <Field
          label="App credentials"
          htmlFor="add-account-copy"
          hint={source ? `Copies client id, secret, redirect URI and scopes from ${siblingName(source)}. Access tokens are never copied.` : "You'll enter client id, secret and scopes under Configure after adding."}
        >
          <Select id="add-account-copy" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">Start empty</option>
            {siblings.map((s) => <option key={s.id} value={s.id}>Copy from {siblingName(s)}</option>)}
          </Select>
        </Field>
        <Field label="Mode" htmlFor="add-account-mode" hint={mode === "sandbox" ? "Simulates publishing without calling the network. Switch to Live when credentials are ready." : "Publishes to the real network once connected."}>
          <Select id="add-account-mode" value={mode} onChange={(e) => setMode(e.target.value as "sandbox" | "live")}>
            <option value="sandbox">Sandbox (simulated)</option>
            <option value="live">Live (real API)</option>
          </Select>
        </Field>
      </form>
    </Modal>
  );
}
