import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import type { AccessRequest, AccessRequestApproveInput, AccessRequestStatus, Organization, UserRole } from "@socmedia/shared";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Modal, SegmentedTabs, Select, Skeleton } from "@/components/ui";
import { useOrgs } from "@/hooks/useOrg";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { relativeTime } from "@/lib/utils";
import { TemporaryPasswordReveal } from "./passwordUtils";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

type InviteRole = Exclude<UserRole, "owner">;
const ROLE_LABEL: Record<InviteRole, string> = { admin: "Admin", editor: "Editor", viewer: "Viewer" };

const STATUS_TABS: { id: AccessRequestStatus; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "declined", label: "Declined" },
];

function useAccessRequests(status: AccessRequestStatus) {
  return useQuery({ queryKey: qk.accessRequests(status), queryFn: () => api.users.accessRequests.list(status) });
}

type OrgAccessMode = "all" | "pick";

function OrgAccessField({ orgs, mode, setMode, selected, toggle }: {
  orgs: Organization[];
  mode: OrgAccessMode;
  setMode: (m: OrgAccessMode) => void;
  selected: string[];
  toggle: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-ink-700">Organization access</span>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="radio" className="control-accent focus-ring" name="approve-org-access" checked={mode === "all"} onChange={() => setMode("all")} />
        All organizations
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="radio" className="control-accent focus-ring" name="approve-org-access" checked={mode === "pick"} onChange={() => setMode("pick")} />
        Specific organizations
      </label>
      {mode === "pick" && (
        <div className="ml-6 max-h-36 space-y-1 overflow-y-auto pr-1">
          {orgs.length === 0 && <p className="text-xs text-ink-500">No organizations yet.</p>}
          {orgs.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" className="control-accent focus-ring" checked={selected.includes(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} />
              {o.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

interface ApproveModalProps {
  request: AccessRequest | null;
  orgs: Organization[];
  onClose: () => void;
}

function ApproveModal({ request, orgs, onClose }: ApproveModalProps) {
  const qc = useQueryClient();
  const [role, setRole] = useState<InviteRole>("editor");
  const [mode, setMode] = useState<OrgAccessMode>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<{ temporaryPassword?: string; magicLinkSent: boolean } | null>(null);

  const approve = useMutation({
    mutationFn: (input: AccessRequestApproveInput) => api.users.accessRequests.approve(request!.id, input),
    onSuccess: (data) => {
      setResult({ temporaryPassword: data.temporaryPassword, magicLinkSent: data.magicLinkSent });
      qc.invalidateQueries({ queryKey: qk.accessRequests("pending") });
      qc.invalidateQueries({ queryKey: qk.accessRequests("approved") });
      qc.invalidateQueries({ queryKey: qk.users });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!request) return null;

  const close = () => { onClose(); setRole("editor"); setMode("all"); setSelected([]); setResult(null); approve.reset(); };
  const orgIds: string[] | "*" = mode === "all" ? "*" : selected;
  const empty = mode === "pick" && selected.length === 0;

  const submit = () => approve.mutate({ role, orgIds });

  return (
    <Modal open={!!request} onClose={close} title={result ? "Access granted" : `Approve ${request.name}`} size="md">
      {result ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-600">{request.email} can now sign in.</p>
          {result.temporaryPassword ? (
            <TemporaryPasswordReveal password={result.temporaryPassword} note="Share this temporary password with them." />
          ) : (
            <p className="notice-info" role="status">
              {result.magicLinkSent ? "Sign-in link sent to their email." : "They can sign in with a link or Google."}
            </p>
          )}
          <div className="flex justify-end"><Button onClick={close}>Done</Button></div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-600">{request.email}{request.organization ? ` · ${request.organization}` : ""}</p>
          <div className="space-y-1.5">
            <label htmlFor="approve-role" className="block text-sm font-medium text-ink-700">Role</label>
            <Select id="approve-role" value={role} onChange={(e) => setRole(e.target.value as InviteRole)}>
              {(Object.keys(ROLE_LABEL) as InviteRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
          </div>
          <OrgAccessField orgs={orgs} mode={mode} setMode={setMode} selected={selected} toggle={(id, checked) => setSelected((s) => (checked ? [...s, id] : s.filter((x) => x !== id)))} />
          {empty && orgs.length > 0 && <p className="notice-warning">Pick at least one organization, or choose All organizations.</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="button" onClick={submit} loading={approve.isPending} disabled={empty}>Approve</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DeclineModal({ request, onClose }: { request: AccessRequest | null; onClose: () => void }) {
  const qc = useQueryClient();
  const decline = useMutation({
    mutationFn: () => api.users.accessRequests.decline(request!.id),
    onSuccess: () => {
      toast.success(`Declined ${request!.name}`);
      qc.invalidateQueries({ queryKey: qk.accessRequests("pending") });
      qc.invalidateQueries({ queryKey: qk.accessRequests("declined") });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!request) return null;
  return (
    <Modal
      open={!!request}
      onClose={onClose}
      title="Decline access request?"
      description={`${request.name} (${request.email}) will not be able to sign in.`}
      size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => decline.mutate()} loading={decline.isPending}>Decline</Button></>}
    >
      <p className="text-sm text-ink-500">This can't be undone, but they can submit a new request later.</p>
    </Modal>
  );
}

function RequestRow({ request, showActions, onApprove, onDecline }: {
  request: AccessRequest;
  showActions: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  return (
    <tr className="border-b border-ink-100 last:border-0 hover:bg-ink-50">
      <td className="min-w-[12rem] px-5 py-3">
        <div className="font-medium text-ink-900">{request.name}</div>
        <div className="text-xs text-ink-500 [overflow-wrap:anywhere]">{request.email}</div>
      </td>
      <td className="px-5 py-3 text-sm text-ink-600">{request.organization || <span className="text-ink-400">&mdash;</span>}</td>
      <td className="px-5 py-3 max-w-xs">
        {request.message ? (
          <p className="line-clamp-2 text-xs text-ink-500" title={request.message}>{request.message}</p>
        ) : (
          <span className="text-xs text-ink-400">&mdash;</span>
        )}
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-xs text-ink-500">{relativeTime(request.createdAt)}</td>
      <td className="px-5 py-3">
        {showActions ? (
          <div className="flex items-center justify-end gap-1">
            <Button variant="outline" size="xs" icon={<Check className="h-3.5 w-3.5" />} onClick={onApprove}>Approve</Button>
            <Button variant="ghost" size="xs" className="text-red-600 hover:bg-red-50" icon={<X className="h-3.5 w-3.5" />} onClick={onDecline}>Decline</Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Badge tone={request.status === "approved" ? "success" : "danger"}>{request.status}</Badge>
          </div>
        )}
      </td>
    </tr>
  );
}

/** Pending, approved and declined requests from people outside the allowed sign-in domains. */
export function AccessRequestsCard() {
  const { orgs } = useOrgs();
  const [status, setStatus] = useState<AccessRequestStatus>("pending");
  const pending = useAccessRequests("pending");
  const active = useAccessRequests(status);
  const [approving, setApproving] = useState<AccessRequest | null>(null);
  const [declining, setDeclining] = useState<AccessRequest | null>(null);

  const rows = active.data ?? [];
  const pendingCount = pending.data?.length ?? 0;

  return (
    <Card data-testid="access-requests-card">
      <CardHeader
        className="flex-wrap"
        title={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            Access requests
            {pendingCount > 0 && <Badge tone="warning" className="whitespace-nowrap">{pendingCount} pending</Badge>}
          </span>
        }
        subtitle="Requests from people outside your allowed sign-in domains."
        action={
          <SegmentedTabs<AccessRequestStatus>
            size="sm"
            value={status}
            onChange={setStatus}
            items={STATUS_TABS}
          />
        }
      />
      <CardBody className="p-0">
        {active.isLoading ? (
          <div className="space-y-2 p-5" aria-busy="true" aria-label="Loading access requests">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title={status === "pending" ? "No pending requests" : `No ${status} requests`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm" data-testid="access-requests-table">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs font-medium uppercase tracking-wide text-ink-500">
                  <th className="px-5 py-2">Name</th>
                  <th className="px-5 py-2">Organization</th>
                  <th className="px-5 py-2">Message</th>
                  <th className="px-5 py-2">Requested</th>
                  <th className="px-5 py-2 text-right">{status === "pending" ? "Actions" : "Status"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RequestRow key={r.id} request={r} showActions={status === "pending"} onApprove={() => setApproving(r)} onDecline={() => setDeclining(r)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
      <ApproveModal request={approving} orgs={orgs} onClose={() => setApproving(null)} />
      <DeclineModal request={declining} onClose={() => setDeclining(null)} />
    </Card>
  );
}
