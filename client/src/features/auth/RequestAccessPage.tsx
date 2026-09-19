import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import type { AccessRequest } from "@socmedia/shared";
import { AuthShell } from "./AuthShell";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

function requestAccessErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return "There is already a pending request or an account for this email";
    if (e.status === 429) return "Too many requests. Try again later.";
    if (e.status === 400) return "Check your name and email address, then try again.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong";
}

/** Loose shape check so an obvious typo gets a field-level message instead of a server 400. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailProblem(value: string): string | null {
  if (!value) return null;
  return EMAIL_RE.test(value.trim()) ? null : "Enter a full email address, like name@company.com";
}

function RequestAccessForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<AccessRequest | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const submitRequest = useMutation({
    mutationFn: () =>
      api.auth.requestAccess({
        name,
        email,
        organization: organization || undefined,
        message: message || undefined,
      }),
    onSuccess: setResult,
  });

  if (result) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="font-display text-xl text-ink-900">Request received</h1>
        <p className="text-sm text-ink-600">
          We got your request for <span className="font-medium text-ink-900">{result.email}</span>. An owner will
          review it and you will get a sign-in link by email.
        </p>
        <Link className="auth-tap link focus-ring block text-sm" to="/">Back to sign in</Link>
      </div>
    );
  }

  const valid = !!name && !!email;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const problem = emailProblem(email);
    if (problem) {
      setEmailError(problem);
      document.getElementById("request-email")?.focus();
      return;
    }
    submitRequest.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="text-center">
        <h1 className="font-display text-xl text-ink-900">Request access</h1>
        <p className="mt-1 text-sm text-ink-500">Tell us who you are and we'll get you set up.</p>
      </div>
      <Field label="Name" htmlFor="request-name">
        <Input id="request-name" autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Work email" htmlFor="request-email" error={emailError}>
        <Input
          id="request-email"
          type="email"
          autoComplete="email"
          value={email}
          aria-invalid={emailError ? true : undefined}
          onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(null); }}
          onBlur={() => setEmailError(emailProblem(email))}
          required
        />
      </Field>
      <Field label="Organization" htmlFor="request-org" hint="Optional">
        <Input id="request-org" value={organization} onChange={(e) => setOrganization(e.target.value)} />
      </Field>
      <Field label="Why do you need access?" htmlFor="request-message" hint="Optional">
        <Textarea id="request-message" maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      {submitRequest.isError && <p className="notice-danger" role="alert">{requestAccessErrorMessage(submitRequest.error)}</p>}
      <Button type="submit" className="w-full" loading={submitRequest.isPending} disabled={!valid}>Request access</Button>
      <Link className="auth-tap link focus-ring block text-center text-sm" to="/">Back to sign in</Link>
    </form>
  );
}

/** Public page (no session) where someone outside the allowed domains can ask an owner for access. */
export function RequestAccessPage() {
  return (
    <AuthShell>
      <RequestAccessForm />
    </AuthShell>
  );
}
