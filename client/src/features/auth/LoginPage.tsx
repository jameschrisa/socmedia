import { useEffect, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import type { MagicLinkRequestResult } from "@socmedia/shared";
import { useAuth, useAuthMutations } from "@/hooks/useAuth";
import { Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { AuthShell } from "./AuthShell";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

/** Copy for `?auth=error&reason=` redirects the server sends back after a failed
 * magic-link or Google round trip (see routes GET /auth/magic/verify and /auth/google/start). */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  expired: "That sign-in link has expired. Request a new one.",
  invalid: "That sign-in link is not valid.",
  domain: "Only approved email domains can sign in. Request access below.",
  inactive: "This account has been deactivated.",
  google: "Google sign-in did not complete. Try again.",
  state: "The sign-in session expired. Try again.",
};

/** Reads and then strips `?auth=error&reason=...` from the URL, once, on mount. */
function useAuthErrorFromUrl(): string | null {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") !== "error") return;
    const reason = params.get("reason") ?? "";
    setMessage(AUTH_ERROR_MESSAGES[reason] ?? "Something went wrong signing in. Try again.");
    params.delete("auth");
    params.delete("reason");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
  }, []);
  return message;
}

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z" />
      <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z" />
      <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z" />
      <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z" />
    </svg>
  );
}

/** "Continue with Google" is a full-page navigation, not a fetch, so it's a plain link styled as a button. */
function GoogleButton() {
  return (
    <a
      href="/api/auth/google/start"
      className="auth-tap inline-flex w-full items-center justify-center gap-2 h-9 px-4 text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px focus-ring glass-veil text-ink-800 hover:bg-glass-strong hover:border-ink-300"
    >
      <GoogleGlyph className="h-4 w-4 shrink-0" />
      Continue with Google
    </a>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 text-xs text-ink-400" aria-hidden>
      <span className="h-px flex-1 bg-ink-200" />
      or
      <span className="h-px flex-1 bg-ink-200" />
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
        className="auth-eye focus-ring absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-ink-400 hover:text-ink-700"
      >
        {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** Password form: email (seeded from whatever was already typed above) + password. */
function PasswordForm({ login, initialEmail }: { login: LoginMutation; initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    login.mutate({ email, password });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Email" htmlFor="login-email">
        <Input id="login-email" type="email" autoComplete="username" autoFocus={!initialEmail} value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Password" htmlFor="login-password">
        <PasswordInput id="login-password" autoComplete="current-password" autoFocus={!!initialEmail} value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      {login.isError && <FormError error={login.error} />}
      <Button type="submit" className="w-full" loading={login.isPending} disabled={!email || !password}>Sign in</Button>
    </form>
  );
}

/** Email field + "Email me a sign-in link" button, then a "Check your email" confirmation. */
function MagicLinkForm({ email, setEmail }: { email: string; setEmail: (v: string) => void }) {
  const [sent, setSent] = useState<MagicLinkRequestResult | null>(null);
  const request = useMutation({
    mutationFn: () => api.auth.requestMagicLink({ email }),
    onSuccess: setSent,
  });

  if (sent) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm text-ink-700 [overflow-wrap:anywhere]">
          <span className="font-medium text-ink-900">Check your email.</span> We sent a sign-in link to {email}.
        </p>
        {sent.delivered === "log" && sent.link && (
          <p className="notice-info text-left">
            Development mode: no mail provider is configured, so here's the link.{" "}
            <a className="link break-all" href={sent.link}>{sent.link}</a>
          </p>
        )}
        <button type="button" className="auth-tap link focus-ring text-sm" onClick={() => { setSent(null); request.reset(); }}>
          Use a different email
        </button>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email) return;
    request.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Email" htmlFor="magic-email">
        <Input id="magic-email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      {request.isError && <FormError error={request.error} />}
      <Button type="submit" className="w-full" loading={request.isPending} disabled={!email}>Email me a sign-in link</Button>
    </form>
  );
}

function SignInView({ login }: { login: LoginMutation }) {
  const { providers } = useAuth();
  const urlError = useAuthErrorFromUrl();
  const [email, setEmail] = useState("");
  const hasPrimary = providers.magicLink || providers.google;
  // `null` until the person picks a method themselves; until then, follow whatever the server
  // says is available (which may still be loading its default the first time this renders).
  const [manualShowPassword, setManualShowPassword] = useState<boolean | null>(null);
  const showPassword = manualShowPassword ?? (!hasPrimary && providers.password);

  return (
    <div className="space-y-5">
      <h1 className="font-display text-xl text-ink-900 text-center">Only authorized suprstars allowed</h1>

      {urlError && <p className="notice-danger" role="alert">{urlError}</p>}

      {showPassword ? (
        <div className="space-y-4">
          <PasswordForm login={login} initialEmail={email} />
          {hasPrimary && (
            <button type="button" className="auth-tap link focus-ring block w-full text-center text-sm" onClick={() => setManualShowPassword(false)}>
              Use a sign-in link instead
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {providers.magicLink && <MagicLinkForm email={email} setEmail={setEmail} />}
          {providers.magicLink && (providers.google || providers.password) && <Divider />}
          {providers.google && <GoogleButton />}
          {providers.password && (providers.magicLink || providers.google) && (
            <button type="button" className="auth-tap link focus-ring block w-full text-center text-sm" onClick={() => setManualShowPassword(true)}>
              Use a password instead
            </button>
          )}
        </div>
      )}

      <div className="space-y-1 border-t border-ink-200 pt-4 text-center text-xs text-ink-400">
        <p>
          Not a suprstar yet?{" "}
          <Link className="auth-tap-inline link" to="/request-access">Request access</Link>
        </p>
      </div>
    </div>
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
        {email && <p className="mt-1 text-xs text-ink-400 [overflow-wrap:anywhere]">Signed in as {email}</p>}
      </div>
      <Field label="Current password" htmlFor="change-current-password" hint="The temporary password you just signed in with.">
        <PasswordInput id="change-current-password" autoComplete="current-password" autoFocus value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
      </Field>
      <Field label="New password" htmlFor="change-new-password" hint="At least 8 characters.">
        <PasswordInput id="change-new-password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
      </Field>
      {changePassword.isError && <FormError error={changePassword.error} />}
      <Button type="submit" className="w-full" loading={changePassword.isPending} disabled={!valid}>Update password</Button>
      <Button type="button" variant="ghost" size="sm" className="auth-tap w-full" onClick={() => logout.mutate(undefined)} loading={logout.isPending}>
        Not you? Sign out
      </Button>
    </form>
  );
}

/**
 * Full-screen sign-in gate. Shows one of three steps depending on session state:
 * first-run setup, plain sign-in (magic link / Google / password), or a forced
 * password change for temporary passwords.
 */
export function LoginPage() {
  const { needsSetup, user, authenticated } = useAuth();
  const { login, setup, changePassword, logout } = useAuthMutations();

  if (authenticated && user?.mustChangePassword) {
    return <AuthShell><PasswordChangeStep changePassword={changePassword} logout={logout} email={user.email} /></AuthShell>;
  }

  if (needsSetup) {
    return <AuthShell><SetupStep setup={setup} /></AuthShell>;
  }

  return <AuthShell><SignInView login={login} /></AuthShell>;
}
