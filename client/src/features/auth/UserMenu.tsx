import { useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { KeyRound, LogOut, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { useAuth, useAuthMutations } from "@/hooks/useAuth";
import { Badge, Button, Field, Input, Modal, Portal, useAnchorPosition } from "@/components/ui";
import { cn, initials } from "@/lib/utils";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

const ROLE_TONE = { owner: "brand", admin: "brand", editor: "info", viewer: "neutral" } as const;

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { changePassword } = useAuthMutations();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const valid = !!currentPassword && newPassword.length >= 8;

  const close = () => {
    onClose();
    setCurrentPassword("");
    setNewPassword("");
    changePassword.reset();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    changePassword.mutate({ currentPassword, newPassword }, {
      onSuccess: () => { toast.success("Password updated"); close(); },
    });
  };

  return (
    <Modal open={open} onClose={close} title="Change password" size="sm">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Current password" htmlFor="menu-current-password">
          <Input id="menu-current-password" type="password" autoComplete="current-password" autoFocus value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </Field>
        <Field label="New password" htmlFor="menu-new-password" hint="At least 8 characters.">
          <Input id="menu-new-password" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
        </Field>
        {changePassword.isError && <p className="text-sm text-red-600" role="alert">{errorMessage(changePassword.error)}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" loading={changePassword.isPending} disabled={!valid}>Update password</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Square avatar button showing the signed-in user's initials, with a menu for account actions. */
export function UserMenu() {
  const { user, can } = useAuth();
  const { logout } = useAuthMutations();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const MENU_W = 240;
  const pos = useAnchorPosition(triggerRef, open, { align: "right", offset: 8, width: MENU_W });

  // Only mount once a user is actually loaded, so pages/tests that never stub
  // /auth/me (treated as signed out) render a normal header without this control.
  if (!user) return null;

  const doLogout = () => {
    setOpen(false);
    logout.mutate(undefined, {
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.name}`}
        data-testid="user-menu-trigger"
        className="flex h-8 w-8 shrink-0 items-center justify-center bg-brand-500 text-[11px] font-bold text-[color:var(--c-on-brand)] hover:bg-brand-600"
      >
        {initials(user.name)}
      </button>

      <Portal>
        <AnimatePresence>
          {open && (
            <>
              <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_W }}
                className="z-[100] card glass-menu p-1.5 shadow-pop"
                data-testid="user-menu"
              >
                <div className="px-2.5 py-2">
                  <p className="truncate text-sm font-semibold text-ink-900">{user.name}</p>
                  <p className="truncate text-xs text-ink-500">{user.email}</p>
                  <Badge tone={ROLE_TONE[user.role]} className="mt-1.5">{user.role}</Badge>
                </div>
                <div className={cn("border-t border-ink-100 pt-1")}>
                  <button
                    type="button"
                    onClick={() => { setOpen(false); setPwOpen(true); }}
                    className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm text-ink-700 hover:bg-ink-50"
                  >
                    <KeyRound className="h-4 w-4" /> Change password
                  </button>
                  {can.manageUsers && (
                    <button
                      type="button"
                      onClick={() => { setOpen(false); navigate("/settings#users"); }}
                      className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm text-ink-700 hover:bg-ink-50"
                    >
                      <UsersIcon className="h-4 w-4" /> Users
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={doLogout}
                    className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </Portal>

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
