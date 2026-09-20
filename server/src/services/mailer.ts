import type { MailStatus } from "@socmedia/shared";
import { config } from "../config";
import { log } from "./logger";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type MailProviderName = "resend" | "smtp" | "log";

export interface MailerStatus {
  provider: MailProviderName;
  /** True when the selected provider has everything it needs to actually send mail. */
  configured: boolean;
}

function providerName(): MailProviderName {
  const raw = (config.mailProvider || "log").toLowerCase();
  return raw === "resend" || raw === "smtp" ? raw : "log";
}

/** Which provider is selected and whether it's ready to send (vs. falling back to the log). */
export function mailerStatus(): MailerStatus {
  const provider = providerName();
  if (provider === "resend") return { provider, configured: !!config.resendApiKey && !!config.mailFrom };
  if (provider === "smtp") return { provider, configured: !!config.smtpUrl && !!config.mailFrom };
  return { provider: "log", configured: false };
}

/**
 * True when magic-link sign-in can actually deliver something usable: a real mailer is configured,
 * or we're outside production where links fall back to the activity log a developer can click.
 */
export function magicLinkAvailable(): boolean {
  const status = mailerStatus();
  if (status.configured) return true;
  return status.provider === "log" && config.nodeEnv !== "production";
}

function logFallback(msg: MailMessage): void {
  log.info("auth", `Mail (log delivery): ${msg.subject}`, { data: { to: msg.to, text: msg.text } });
}

async function sendViaResend(msg: MailMessage): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.resendApiKey}`,
    },
    body: JSON.stringify({
      from: config.mailFrom,
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend send failed: ${res.status} ${body}`);
  }
}

// Lazily created and cached so we only pay nodemailer's connection-parsing cost once per process.
let smtpTransport: { sendMail: (opts: Record<string, unknown>) => Promise<unknown> } | undefined;

async function sendViaSmtp(msg: MailMessage): Promise<void> {
  if (!smtpTransport) {
    const nodemailer = await import("nodemailer");
    smtpTransport = nodemailer.default.createTransport(config.smtpUrl);
  }
  await smtpTransport.sendMail({
    from: config.mailFrom,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    ...(msg.html ? { html: msg.html } : {}),
  });
}

/** Test-only: forces the next sendViaSmtp() call to recreate its transport. */
export function resetSmtpTransport(): void {
  smtpTransport = undefined;
}

export interface SendMailResult {
  delivered: "email" | "log";
}

/* ---------------------------------------------------------------------- */
/* Mail self-test (Settings -> Email delivery)                            */
/* ---------------------------------------------------------------------- */

interface MailTestState {
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

function emptyMailTestState(): MailTestState {
  return { lastTestAt: null, lastTestOk: null, lastTestError: null };
}

let testState: MailTestState = emptyMailTestState();

/** Test-only: clears the in-memory last-test-result state between test files. */
export function _resetMailTestStateForTests(): void {
  testState = emptyMailTestState();
}

const MAIL_TEST_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAIL_TEST_MAX = 5;
const mailTestAttempts = new Map<string, number[]>();

/** True (and records the attempt) when `key` (the requesting user's id) is still under the hourly self-test cap. */
export function checkMailTestRateLimit(key: string, now: number = Date.now()): boolean {
  const recent = (mailTestAttempts.get(key) ?? []).filter((t) => now - t < MAIL_TEST_WINDOW_MS);
  if (recent.length >= MAIL_TEST_MAX) {
    mailTestAttempts.set(key, recent);
    return false;
  }
  recent.push(now);
  mailTestAttempts.set(key, recent);
  return true;
}

/** Test-only: clears mail-test rate-limit state between test files. */
export function resetMailTestRateLimits(): void {
  mailTestAttempts.clear();
}

/**
 * `MailStatus` for the Settings page and the send-test action: what's configured, what address
 * mail comes from, whether magic links can actually be delivered, and the last self-test result.
 */
export function fullMailStatus(): MailStatus {
  const status = mailerStatus();
  return {
    provider: status.provider,
    configured: status.configured,
    from: config.mailFrom || null,
    canSendMagicLinks: magicLinkAvailable(),
    lastTestAt: testState.lastTestAt,
    lastTestOk: testState.lastTestOk,
    lastTestError: testState.lastTestError,
  };
}

/**
 * Sends a short test message to `to` through whatever provider is actually configured (bypassing
 * `sendMail`'s silent log fallback, so a real provider failure is visible here instead of masked as
 * "delivered"), and records the outcome for `fullMailStatus()`. Never throws: a failed send is
 * recorded as `lastTestOk: false` with the error message so the route can always answer 200.
 */
export async function sendMailTest(to: string): Promise<MailStatus> {
  const status = mailerStatus();
  const message: MailMessage = {
    to,
    subject: "suprstar mail test",
    text: "This is a test message from suprstar. If you're reading it in your inbox, magic-link sign-in and access-request notices will be delivered to this address the same way.",
  };
  const now = new Date().toISOString();

  if (!status.configured) {
    // No real provider configured: be honest that this only reached the activity log, not an inbox.
    logFallback(message);
    testState = {
      lastTestAt: now,
      lastTestOk: true,
      lastTestError: "No mail provider is configured, so the test message was written to the activity log only — it was not delivered to an inbox.",
    };
    return fullMailStatus();
  }

  try {
    if (status.provider === "resend") await sendViaResend(message);
    else if (status.provider === "smtp") await sendViaSmtp(message);
    log.info("auth", `Mail test sent to ${to}`, { data: { to, provider: status.provider } });
    testState = { lastTestAt: now, lastTestOk: true, lastTestError: null };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.warn("auth", `Mail test to ${to} failed: ${errorMessage}`, { data: { to, provider: status.provider } });
    testState = { lastTestAt: now, lastTestOk: false, lastTestError: errorMessage };
  }
  return fullMailStatus();
}

/**
 * Sends a message through the configured provider (Resend HTTP API or SMTP via nodemailer). Falls
 * back to writing the message to the activity log (source "auth") when no provider is configured,
 * or when the send itself fails, so sign-in never hard-fails because mail is down. Never logs
 * secrets other than the message text itself (which, for magic links, is the point).
 */
export async function sendMail(msg: MailMessage): Promise<SendMailResult> {
  const status = mailerStatus();
  try {
    if (status.provider === "resend" && status.configured) {
      await sendViaResend(msg);
      return { delivered: "email" };
    }
    if (status.provider === "smtp" && status.configured) {
      await sendViaSmtp(msg);
      return { delivered: "email" };
    }
  } catch (err) {
    log.warn("auth", `Mail delivery failed, falling back to the activity log: ${err instanceof Error ? err.message : String(err)}`, {
      data: { to: msg.to, provider: status.provider },
    });
  }
  logFallback(msg);
  return { delivered: "log" };
}
