import path from "node:path";

/** Splits a comma/whitespace-separated env list into trimmed, lowercased, de-duplicated entries. */
function emailList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,\s]+/)) {
    const email = part.trim().toLowerCase();
    if (email.includes("@")) seen.add(email);
  }
  return [...seen];
}

function num(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

const dataDirRaw = process.env.DATA_DIR || path.resolve(process.cwd(), "data");

export const config = {
  port: num("PORT", 4000),
  dataDir: path.resolve(dataDirRaw),
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-opus-5",
  schedulerIntervalMs: num("SCHEDULER_INTERVAL_MS", 30000),
  secretKey: process.env.SECRET_KEY || "dev-insecure-secret-key-change-me",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  nodeEnv: process.env.NODE_ENV || "development",
  isTest: process.env.NODE_ENV === "test" || !!process.env.VITEST,
  adminEmail: process.env.ADMIN_EMAIL || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  adminName: process.env.ADMIN_NAME || "Owner",
  /**
   * Root administrators (see server/src/services/rootAdmins.ts): comma-separated emails that are
   * always owners with access to every organization, whatever the sign-in policy's domain rules
   * would otherwise grant them, and that no admin can demote, deactivate, narrow or delete.
   * Deliberately an environment variable rather than an in-app setting, so changing who holds
   * root needs access to the host rather than an admin session.
   */
  rootAdminEmails: emailList("ROOT_ADMIN_EMAILS"),
  /** Test-only: when set (and isTest), attachUser treats cookie-less requests as this user id. */
  testAuthUserId: null as string | null,
  /** Google SSO (see server/src/services/googleAuth.ts). Both must be set for /auth/google/* to work. */
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  /** Microsoft Entra ID SSO (see server/src/services/entraAuth.ts). Client id + secret must both be set for /auth/entra/* to work; tenant defaults to "organizations" (any work/school account). */
  entraClientId: process.env.ENTRA_CLIENT_ID || "",
  entraClientSecret: process.env.ENTRA_CLIENT_SECRET || "",
  entraTenantId: process.env.ENTRA_TENANT_ID || "organizations",
  /** Outbound mail (see server/src/services/mailer.ts): "resend" | "smtp" | "log" (default). */
  mailProvider: (process.env.MAIL_PROVIDER || "log").toLowerCase(),
  mailFrom: process.env.MAIL_FROM || "",
  resendApiKey: process.env.RESEND_API_KEY || "",
  smtpUrl: process.env.SMTP_URL || "",
  /** In-app OS terminal (see server/src/services/terminal.ts). "on" | "off"; env OS_TERMINAL; default on outside production. */
  osTerminal: ((process.env.OS_TERMINAL || (process.env.NODE_ENV === "production" ? "off" : "on")).toLowerCase() === "off" ? "off" : "on") as "on" | "off",

  /** Backups (see server/src/services/backup.ts). Default on; "false"/"0" disables the scheduler (tests, local dev). */
  backupEnabled: !["false", "0"].includes((process.env.BACKUP_ENABLED || "").toLowerCase()),
  /** How often the backup scheduler checks whether a fresh archive is due. Not itself the backup cadence. */
  backupIntervalHours: num("BACKUP_INTERVAL_HOURS", 24),
  /** Local archives kept after rotation; older ones are pruned. */
  backupKeep: num("BACKUP_KEEP", 7),
  /** S3-compatible offsite storage (AWS S3, Cloudflare R2, Backblaze B2). Offsite upload is skipped entirely when bucket is unset. */
  backupS3Bucket: process.env.BACKUP_S3_BUCKET || "",
  backupS3Region: process.env.BACKUP_S3_REGION || "auto",
  /** Set for R2/B2; forces path-style addressing. Leave unset for real AWS S3. */
  backupS3Endpoint: process.env.BACKUP_S3_ENDPOINT || "",
  backupS3AccessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID || "",
  backupS3SecretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY || "",
  backupS3Prefix: process.env.BACKUP_S3_PREFIX || "suprstar",
};

export type Config = typeof config;
