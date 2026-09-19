import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAuth, useAuthMutations } from "@/hooks/useAuth";
import { useThemeMode } from "@/hooks/useThemeMode";
import { Button, Field, Input, SparkMark, Wordmark } from "@/components/ui";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

/** Full-bleed looping background clip behind the sign-in card. Falls back to the poster frame
 * only (no video element at all) when the user prefers reduced motion, and pauses while the
 * tab is hidden so it doesn't burn battery in a background tab. */
function LoginBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = () => setReducedMotion(mq.matches);
    mq.addEventListener?.("change", listener);
    return () => mq.removeEventListener?.("change", listener);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const onVisibility = () => {
      const el = videoRef.current;
      if (!el) return;
      if (document.hidden) el.pause();
      else el.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [reducedMotion]);

  return (
    <div className="fixed inset-0 z-0 overflow-hidden" aria-hidden>
      {reducedMotion ? (
        <img src="/media/login-bg.jpg" alt="" className="h-full w-full object-cover" />
      ) : (
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/media/login-bg.jpg"
        >
          <source src="/media/login-bg.mp4" type="video/mp4" />
        </video>
      )}
      {/* Dark glass scrim so the sign-in card stays readable over the footage in both themes. */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(180deg, rgba(5,6,12,0.32) 0%, rgba(5,6,12,0.52) 55%, rgba(5,6,12,0.74) 100%)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
        }}
      />
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  // The sign-in gate renders outside AppShell, so it applies the stored theme itself.
  useThemeMode();
  return (
    <div className="relative min-h-screen flex items-center justify-center p-4">
      <LoginBackground />
      {/* The one rounded surface in the product: dark glass in both themes because it sits over footage (see .login-card). */}
      <div className="login-card relative z-10 w-full max-w-sm p-8 space-y-6 drift-in" data-testid="login-card">
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <SparkMark size={26} className="login-mark" />
            <Wordmark size="lg" />
          </div>
          <p className="login-caption">powered by F3i</p>
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
