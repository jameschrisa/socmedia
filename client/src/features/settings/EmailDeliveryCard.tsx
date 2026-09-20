import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MailStatus } from "@socmedia/shared";
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Skeleton } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/queryClient";

const PROVIDER_LABEL: Record<MailStatus["provider"], string> = {
  resend: "Resend",
  smtp: "SMTP",
  log: "Not configured",
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

/**
 * What the mail provider is doing right now (Settings → Users & access), and a way to send a
 * test message to confirm it actually works. Mirrors SignInPolicyCard's layout so the two sit
 * comfortably side by side.
 */
export function EmailDeliveryCard() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const status = useQuery({ queryKey: qk.mailStatus, queryFn: api.settings.getMail });

  const [to, setTo] = useState("");
  const [toTouched, setToTouched] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Seed the "send to" field with the signed-in user's own address once it's known, but only
  // until the person edits it themselves.
  useEffect(() => {
    if (!toTouched && user?.email) setTo((current) => current || user.email);
  }, [user?.email, toTouched]);

  const test = useMutation({
    mutationFn: (input: { to: string }) => api.settings.sendMailTest(input),
    onSuccess: (data) => {
      qc.setQueryData(qk.mailStatus, data);
      setSendError(null);
    },
    onError: (e: unknown) => {
      setSendError(
        e instanceof ApiError && e.status === 429
          ? "Too many test emails sent. Wait a few minutes and try again."
          : errorMessage(e),
      );
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!to) return;
    test.mutate({ to });
  };

  const data = status.data;

  return (
    <Card data-testid="email-delivery-card">
      <CardHeader title="Email delivery" subtitle="What suprstar can send right now, and where the test messages go." />
      <CardBody className="space-y-4">
        {!data ? (
          <Skeleton className="h-32" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={data.configured ? "success" : data.provider === "log" ? "neutral" : "warning"}>{PROVIDER_LABEL[data.provider]}</Badge>
              <span className="text-sm text-ink-700">
                From: <span className="font-mono text-ink-900">{data.from ?? "not set"}</span>
              </span>
            </div>

            {data.canSendMagicLinks ? (
              <p className="notice-info">Magic sign-in links can be delivered from this address.</p>
            ) : (
              <p className="notice-warning">
                Magic links can't be delivered yet, so anyone signing in needs a password or another method. Set{" "}
                <code className="font-mono">MAIL_PROVIDER</code> and a key on the API host to turn them on.
              </p>
            )}

            <form onSubmit={submit} className="flex flex-wrap items-end gap-2 border-t border-ink-100 pt-4">
              <div className="min-w-[220px] flex-1">
                <Field label="Send a test email" htmlFor="mail-test-to">
                  <Input
                    id="mail-test-to"
                    type="email"
                    value={to}
                    onChange={(e) => { setTo(e.target.value); setToTouched(true); }}
                    required
                  />
                </Field>
              </div>
              <Button type="submit" size="md" loading={test.isPending} disabled={!to}>Send a test email</Button>
            </form>

            {sendError && <p className="notice-danger" role="alert">{sendError}</p>}

            {!sendError && data.lastTestAt && data.lastTestOk && (
              <p className="notice-info" data-testid="mail-test-success">
                {data.provider === "log" ? (
                  <>Test message written to the activity log. Logging providers don't deliver to a real mailbox.</>
                ) : (
                  <>Test email sent at {new Date(data.lastTestAt).toLocaleString()}.</>
                )}
              </p>
            )}
            {!sendError && data.lastTestAt && data.lastTestOk === false && (
              <p className="notice-danger" role="alert" data-testid="mail-test-failure">
                {data.lastTestError ?? "The test email failed to send."}
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
