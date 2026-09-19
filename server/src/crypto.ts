import crypto from "node:crypto";
import { config } from "./config";

function deriveKey(secretKey: string): Buffer {
  return crypto.createHash("sha256").update(secretKey, "utf8").digest();
}

const KEY = deriveKey(config.secretKey);

/** Encrypt a secret string at rest with AES-256-GCM. Returns "" for empty input. */
export function encrypt(plain: string | null | undefined): string {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** Decrypt a value previously produced by encrypt(). Returns "" on any failure/legacy value. */
export function decrypt(value: string | null | undefined): string {
  if (!value) return "";
  if (!value.startsWith("enc:")) return "";
  const parts = value.split(":");
  if (parts.length !== 4) return "";
  const [, ivB64, tagB64, dataB64] = parts;
  try {
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return "";
  }
}

/** Mask a secret for API responses: "" when empty, otherwise "••••" + last 4 chars. */
export function mask(secret: string | null | undefined): string {
  if (!secret) return "";
  const last4 = secret.slice(-4);
  return `••••${last4}`;
}

/** True when a value looks like a masked placeholder from mask(). */
export function isMasked(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("••••");
}
