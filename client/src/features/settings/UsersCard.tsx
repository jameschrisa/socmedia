import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { Organization, User, UserCreateInput, UserRole, UserUpdateInput } from "@socmedia/shared";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, Select, Skeleton, Toggle } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useOrgs } from "@/hooks/useOrg";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { cn, relativeTime } from "@/lib/utils";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

const ROLE_LABEL: Record<UserRole, string> = { owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer" };
const ROLE_TONE: Record<UserRole, "brand" | "info" | "neutral"> = { owner: "brand", admin: "brand", editor: "info", viewer: "neutral" };

function generatePassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint32Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 0xffffffff);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Couldn't copy. Select the password and copy it manually.");
  }
}

function orgAccessLabel(orgIds: string[] | "*", orgs: Organization[]): string {
  if (orgIds === "*") return "All organizations";
  if (orgIds.length === 0) return "No organizations";
  const names = orgIds.map((id) => orgs.find((o) => o.id === id)?.name ?? id);
  return `${orgIds.length} org${orgIds.length === 1 ? "" : "s"}: ${names.join(", ")}`;
}

/** Data hooks for the users list, colocated here since user management is settings-only. */
function useUsers() {
  return useQuery({ queryKey: qk.users, queryFn: api.users.list });
}

function useUserMutations() {
  const qc = useQueryClient();
  const replace = (u: User) => qc.setQueryData<User[]>(qk.users, (old) => (old ? old.map((x) => (x.id === u.id ? u : x)) : old));
  const create = useMutation({
    mutationFn: (input: UserCreateInput) => api.users.create(input),
    onSuccess: (u) => qc.setQueryData<User[]>(qk.users, (old) => (old ? [...old, u] : [u])),
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UserUpdateInput }) => api.users.update(id, input),
    onSuccess: replace,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.users.remove(id),
    onSuccess: (_void, id) => qc.setQueryData<User[]>(qk.users, (old) => (old ? old.filter((x) => x.id !== id) : old)),
  });
  return { create, update, remove };
}

type OrgAccessMode = "all" | "pick";

function useOrgAccessState(initial: string[] | "*") {
  const [mode, setMode] = useState<OrgAccessMode>(initial === "*" ? "all" : "pick");
  const [selected, setSelected] = useState<string[]>(initial === "*" ? [] : initial);
  const toggle = (id: string, checked: boolean) => setSelected((s) => (checked ? [...s, id] : s.filter((x) => x !== id)));
  const value: string[] | "*" = mode === "all" ? "*" : selected;
  return { mode, setMode, selected, toggle, value };
}

/** True when the access choice would leave the user unable to open anything. */
function orgAccessEmpty(mode: OrgAccessMode, selected: string[]): boolean {
  return mode === "pick" && selected.length === 0;
}

function OrgAccessField({ formId, orgs, mode, setMode, selected, toggle }: {
  formId: string;
  orgs: Organization[];
  mode: OrgAccessMode;
  setMode: (m: OrgAccessMode) => void;
  selected: string[];
  toggle: (id: string, checked: boolean) => void;
}) {
  const empty = orgAccessEmpty(mode, selected);
  return (
    <Field label="Organization access" hint={mode === "all" ? "Includes organizations created later." : undefined}>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="radio" className="control-accent focus-ring" name={`${formId}-org-access`} checked={mode === "all"} onChange={() => setMode("all")} />
          All organizations
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="radio" className="control-accent focus-ring" name={`${formId}-org-access`} checked={mode === "pick"} onChange={() => setMode("pick")} />
          Specific organizations
        </label>
        {mode === "pick" && (
          <div className="ml-6 space-y-2">
            <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
              {orgs.length === 0 && <p className="text-xs text-ink-500">No organizations yet. Create one first, or choose All organizations.</p>}
              {orgs.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-sm text-ink-700">
                  <input type="checkbox" className="control-accent focus-ring" checked={selected.includes(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} />
                  {o.name}
                </label>
              ))}
            </div>
            {empty && orgs.length > 0 && <p className="notice-warning">Pick at least one organization. With none, this user can sign in but sees nothing.</p>}
          </div>
        )}
      </div>
    </Field>
  );
}

function PasswordField({ id, value, onChange, hint }: { id: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const [reveal, setReveal] = useState(false);
  return (
    <Field label="Temporary password" htmlFor={id} hint={hint ?? "At least 8 characters. The user must change it at first sign-in."}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input id={id} type={reveal ? "text" : "password"} className="pr-9 font-mono" autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} />
          <button type="button" aria-label={reveal ? "Hide password" : "Show password"} aria-pressed={reveal} onClick={() => setReveal((r) => !r)} className="focus-ring absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-ink-400 hover:text-ink-700">
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <Button type="button" variant="outline" icon={<RefreshCw className="h-4 w-4" />} onClick={() => onChange(generatePassword())}>Generate</Button>
      </div>
    </Field>
  );
}

function TemporaryPasswordReveal({ password, note }: { password: string; note: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input readOnly value={password} className="font-mono" aria-label="Temporary password" onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => copyToClipboard(password)} autoFocus>Copy</Button>
      </div>
      <p className="notice-warning" role="status">{note} It won't be shown again.</p>
    </div>
  );
}

interface InviteModalProps {
  open: boolean;
  orgs: Organization[];
  iAmOwner: boolean;
  onClose: () => void;
}

function InviteModal({ open, orgs, iAmOwner, onClose }: InviteModalProps) {
  const { create } = useUserMutations();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("editor");
  const [password, setPassword] = useState(() => generatePassword());
  const orgAccess = useOrgAccessState("*");
  const [result, setResult] = useState<{ email: string; password: string } | null>(null);

  useEffect(() => {
    if (open) {
      setName(""); setEmail(""); setRole("editor"); setPassword(generatePassword());
      setResult(null);
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const valid = !!name && !!email && password.length >= 8 && !orgAccessEmpty(orgAccess.mode, orgAccess.selected);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const input: UserCreateInput = { name, email, role, orgIds: orgAccess.value, password };
    create.mutate(input, {
      onSuccess: () => setResult({ email, password }),
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  const close = () => { onClose(); setResult(null); };

  return (
    <Modal open={open} onClose={close} title={result ? "Temporary password" : "Invite user"} size="md">
      {result ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-600">Share this password with {result.email}. They'll be asked to change it the first time they sign in.</p>
          <TemporaryPasswordReveal password={result.password} note="Make sure to copy this now." />
          <div className="flex justify-end"><Button onClick={close}>Done</Button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Name" htmlFor="invite-name">
            <Input id="invite-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Email" htmlFor="invite-email">
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {iAmOwner && <option value="owner">Owner</option>}
              <option value="admin">Admin</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </Select>
          </Field>
          <OrgAccessField formId="invite" orgs={orgs} mode={orgAccess.mode} setMode={orgAccess.setMode} selected={orgAccess.selected} toggle={orgAccess.toggle} />
          <PasswordField id="invite-password" value={password} onChange={setPassword} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" loading={create.isPending} disabled={!valid}>Invite</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

interface EditModalProps {
  user: User | null;
  orgs: Organization[];
  iAmOwner: boolean;
  canChangeRoleOrActive: boolean;
  onClose: () => void;
}

function EditModal({ user, orgs, iAmOwner, canChangeRoleOrActive, onClose }: EditModalProps) {
  const { update } = useUserMutations();
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("editor");
  const orgAccess = useOrgAccessState(user?.orgIds ?? []);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setRole(user.role);
      orgAccess.setMode(user.orgIds === "*" ? "all" : "pick");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user) return null;
  const valid = !!name && !orgAccessEmpty(orgAccess.mode, orgAccess.selected);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const input: UserUpdateInput = { name, orgIds: orgAccess.value, ...(canChangeRoleOrActive ? { role } : {}) };
    update.mutate({ id: user.id, input }, {
      onSuccess: () => { toast.success(`${name} updated`); onClose(); },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <Modal open={!!user} onClose={onClose} title={`Edit ${user.name}`} size="md">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" htmlFor="edit-name">
          <Input id="edit-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Email">
          <Input value={user.email} readOnly disabled />
        </Field>
        <Field label="Role" htmlFor="edit-role" hint={canChangeRoleOrActive ? undefined : "This user's role can't be changed here."}>
          <Select id="edit-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={!canChangeRoleOrActive}>
            {(iAmOwner || user.role === "owner") && <option value="owner">Owner</option>}
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </Select>
        </Field>
        <OrgAccessField formId="edit" orgs={orgs} mode={orgAccess.mode} setMode={orgAccess.setMode} selected={orgAccess.selected} toggle={orgAccess.toggle} />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={update.isPending} disabled={!valid}>Save changes</Button>
        </div>
      </form>
    </Modal>
  );
}

function SetPasswordModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { update } = useUserMutations();
  const [password, setPassword] = useState(() => generatePassword());
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (user) { setPassword(generatePassword()); setDone(false); update.reset(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return;
    update.mutate({ id: user.id, input: { password } }, {
      onSuccess: () => setDone(true),
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <Modal open={!!user} onClose={onClose} title={done ? "Temporary password" : `Set a temporary password for ${user.name}`} size="sm">
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-600">Share this password with {user.name}. They'll be asked to change it the first time they sign in.</p>
          <TemporaryPasswordReveal password={password} note="Make sure to copy this now." />
          <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <PasswordField id="set-password" value={password} onChange={setPassword} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={update.isPending} disabled={password.length < 8}>Set password</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function DeleteUserModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { remove } = useUserMutations();
  if (!user) return null;
  const confirm = () => {
    remove.mutate(user.id, {
      onSuccess: () => { toast.success(`${user.name} removed`); onClose(); },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };
  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title="Remove user?"
      description={`This permanently removes ${user.name} (${user.email}) and ends their sessions.`}
      size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={confirm} loading={remove.isPending}>Remove</Button></>}
    >
      <p className="text-sm text-ink-500">This can't be undone.</p>
    </Modal>
  );
}

function UserRow({ user, me, orgs, iAmOwner, onEdit, onSetPassword, onDelete }: {
  user: User;
  me: User | null;
  orgs: Organization[];
  iAmOwner: boolean;
  onEdit: (u: User) => void;
  onSetPassword: (u: User) => void;
  onDelete: (u: User) => void;
}) {
  const { update } = useUserMutations();
  const isSelf = user.id === me?.id;
  const targetIsOwner = user.role === "owner";
  const canChangeRoleOrActive = !isSelf && (!targetIsOwner || iAmOwner);
  const canDelete = !isSelf && (!targetIsOwner || iAmOwner);
  const noOrgs = user.orgIds !== "*" && user.orgIds.length === 0;

  return (
    <tr className="border-b border-ink-100 last:border-0 hover:bg-ink-50">
      <td className="px-5 py-3">
        <div className="font-medium text-ink-900">{user.name}</div>
        <div className="text-xs text-ink-500">{user.email}</div>
      </td>
      <td className="px-5 py-3"><Badge tone={ROLE_TONE[user.role]}>{ROLE_LABEL[user.role]}</Badge></td>
      <td className={cn("px-5 py-3 text-xs", noOrgs ? "text-amber-600" : "text-ink-600")}>{orgAccessLabel(user.orgIds, orgs)}</td>
      <td className="px-5 py-3">
        <div className="flex items-center gap-2" title={!canChangeRoleOrActive ? (isSelf ? "You can't deactivate yourself" : "Only an owner can deactivate another owner") : undefined}>
          <Toggle
            size="sm"
            checked={user.active}
            disabled={!canChangeRoleOrActive || update.isPending}
            label={user.active ? `Deactivate ${user.name}` : `Activate ${user.name}`}
            onChange={(active) => update.mutate({ id: user.id, input: { active } }, { onError: (err) => toast.error(errorMessage(err)) })}
          />
          <span className={cn("text-xs", user.active ? "text-ink-700" : "text-ink-500")} aria-hidden>{user.active ? "Active" : "Inactive"}</span>
        </div>
      </td>
      <td className="px-5 py-3 text-xs text-ink-500">{relativeTime(user.lastLoginAt)}</td>
      <td className="px-5 py-3">
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="xs" onClick={() => onEdit(user)} aria-label={`Edit ${user.name}`} title="Edit name, role and access"><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="xs" onClick={() => onSetPassword(user)} aria-label={`Set temporary password for ${user.name}`} disabled={isSelf} title={isSelf ? "Use Change password in your account menu for your own password" : "Set a temporary password"}>
            <KeyRound className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="text-red-600 hover:bg-red-50"
            onClick={() => onDelete(user)}
            disabled={!canDelete}
            aria-label={`Delete ${user.name}`}
            title={canDelete ? "Remove user" : isSelf ? "You can't remove yourself" : "Only an owner can remove another owner"}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function UsersCard() {
  const { user: me } = useAuth();
  const { orgs } = useOrgs();
  const { data: users, isLoading } = useUsers();
  const iAmOwner = me?.role === "owner";

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [pwUser, setPwUser] = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);

  const editTarget = editingUser;
  const canEditTargetRole = editTarget ? editTarget.id !== me?.id && (editTarget.role !== "owner" || iAmOwner) : false;

  return (
    <Card data-testid="users-card">
      <CardHeader
        title="Users & access"
        subtitle="Invite teammates and control what they can do."
        action={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setInviteOpen(true)} data-testid="invite-user-button">Invite user</Button>}
      />
      <CardBody className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-5" aria-busy="true" aria-label="Loading users">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : !users || users.length === 0 ? (
          <EmptyState
            title="No users yet"
            description="Invite your team to give them access to suprstar."
            action={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>Invite user</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="users-table">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs font-medium uppercase tracking-wide text-ink-500 [&>th]:whitespace-nowrap">
                  <th className="px-5 py-2">Name</th>
                  <th className="px-5 py-2">Role</th>
                  <th className="px-5 py-2">Org access</th>
                  <th className="px-5 py-2">Status</th>
                  <th className="px-5 py-2">Last sign-in</th>
                  <th className="px-5 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <UserRow key={u.id} user={u} me={me} orgs={orgs} iAmOwner={iAmOwner} onEdit={setEditingUser} onSetPassword={setPwUser} onDelete={setDeleteUser} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>

      <InviteModal open={inviteOpen} orgs={orgs} iAmOwner={iAmOwner} onClose={() => setInviteOpen(false)} />
      <EditModal user={editTarget} orgs={orgs} iAmOwner={iAmOwner} canChangeRoleOrActive={canEditTargetRole} onClose={() => setEditingUser(null)} />
      <SetPasswordModal user={pwUser} onClose={() => setPwUser(null)} />
      <DeleteUserModal user={deleteUser} onClose={() => setDeleteUser(null)} />
    </Card>
  );
}
