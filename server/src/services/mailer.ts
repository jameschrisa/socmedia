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
