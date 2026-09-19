import { useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAuth, useAuthMutations } from "@/hooks/useAuth";
import { useThemeMode } from "@/hooks/useThemeMode";
import { Button, Field, Input, SparkMark, Wordmark } from "@/components/ui";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

function Shell({ children }: { children: ReactNode }) {
  // The sign-in gate renders outside AppShell, so it applies the stored theme itself.
  useThemeMode();
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card glass-sheet w-full max-w-sm p-8 space-y-6 drift-in">
        <div className="flex items-center justify-center gap-2">
          <SparkMark size={26} />
          <Wordmark size="lg" />
        </div>
        {children}
      </div>
    </div>
  );
}

/** Password input with a show/hide toggle. Temporary passwords are random strings, so people need to see what they typed. */
function PasswordInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={reveal ? "text" : "password"} className={`pr-10 ${className ?? ""}`} />
      <button
        type="button"
        aria-label={reveal ? "Hide password" : "Show password"}
        aria-pressed={reveal}
        onClick={() => setReveal((r) => !r)}
        className="focus-ring absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-ink-400 hover:text-ink-700"
      >
        {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function FormError({ error }: { error: unknown }) {
  return <p className="notice-danger" role="alert">{errorMessage(error)}</p>;
}

type LoginMutation = ReturnType<typeof useAuthMutations>["login"];
type SetupMutation = ReturnType<typeof useAuthMutations>["setup"];
type ChangePasswordMutation = ReturnType<typeof useAuthMutations>["changePassword"];
type LogoutMutation = ReturnType<typeof useAuthMutations>["logout"];

function SignInStep({ login }: { login: LoginMutation }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    login.mutate({ email, password });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="text-center">
        <h1 className="font-display text-xl text-ink-900">Sign in</h1>
        <p className="mt-1 text-sm text-ink-500">Welcome back to suprstar.</p>
      </div>
      <Field label="Email" htmlFor="login-email">
        <Input id="login-email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Password" htmlFor="login-password">
        <PasswordInput id="login-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      {login.isError && <FormError error={login.error} />}
      <Button type="submit" className="w-full" loading={login.isPending} disabled={!email || !password}>Sign in</Button>
    </form>
  );
}

function SetupStep({ setup }: { setup: SetupMutation }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const valid = !!name && !!email && password.length >= 8;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setup.mutate({ name, email, password });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="text-center">
        <h1 className="font-display text-xl text-ink-900">Create the first owner account</h1>
        <p className="mt-1 text-sm text-ink-500">No one has signed in yet. Set up the first owner to get started.</p>
      </div>
      <Field label="Name" htmlFor="setup-name">
        <Input id="setup-name" autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Email" htmlFor="setup-email">
        <Input id="setup-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Password" htmlFor="setup-password" hint="At least 8 characters.">
        <PasswordInput id="setup-password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      {setup.isError && <FormError error={setup.error} />}
      <Button type="submit" className="w-full" loading={setup.isPending} disabled={!valid}>Create account</Button>
    </form>
  );
}

function PasswordChangeStep({ changePassword, logout, email }: { changePassword: ChangePasswordMutation; logout: LogoutMutation; email?: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const valid = !!currentPassword && newPassword.length >= 8;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    changePassword.mutate({ currentPassword, newPassword });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="text-center">
        <h1 className="font-display text-xl text-ink-900">Set a new password</h1>
        <p className="mt-1 text-sm text-ink-500">You're signed in with a temporary password. Choose a new one to continue.</p>
        {email && <p className="mt-1 truncate text-xs text-ink-400">Signed in as {email}</p>}
      </div>
      <Field label="Current password" htmlFor="change-current-password" hint="The temporary password you just signed in with.">
        <PasswordInput id="change-current-password" autoComplete="current-password" autoFocus value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
      </Field>
      <Field label="New password" htmlFor="change-new-password" hint="At least 8 characters.">
        <PasswordInput id="change-new-password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
      </Field>
      {changePassword.isError && <FormError error={changePassword.error} />}
      <Button type="submit" className="w-full" loading={changePassword.isPending} disabled={!valid}>Update password</Button>
      <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => logout.mutate(undefined)} loading={logout.isPending}>
        Not you? Sign out
      </Button>
    </form>
  );
}

/**
 * Full-screen sign-in gate. Shows one of three steps depending on session state:
 * first-run setup, plain sign-in, or a forced password change for temporary passwords.
 */
export function LoginPage() {
  const { needsSetup, user, authenticated } = useAuth();
  const { login, setup, changePassword, logout } = useAuthMutations();

  if (authenticated && user?.mustChangePassword) {
    return <Shell><PasswordChangeStep changePassword={changePassword} logout={logout} email={user.email} /></Shell>;
  }

  if (needsSetup) {
    return <Shell><SetupStep setup={setup} /></Shell>;
  }

  return <Shell><SignInStep login={login} /></Shell>;
}
