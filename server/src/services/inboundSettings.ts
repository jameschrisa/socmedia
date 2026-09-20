import type { InboundChannel, InboundChannelConfig } from "@socmedia/shared";
import { config } from "../config";
import { decrypt, encrypt, isMasked, mask } from "../crypto";
import type { Db } from "../db/database";
import { SettingsRepo } from "../db/repositories/settings";

/** Settings keys that must be encrypted at rest for each channel. */
const SECRET_FIELDS: Record<InboundChannel, string[]> = {
  twilio: ["authToken"],
  telegram: ["botToken"],
  test: [],
};

function settingsKey(channel: InboundChannel): string {
  return `inbound_channel:${channel}`;
}

interface StoredInboundChannel {
  enabled: boolean;
  /** Raw settings; values named in SECRET_FIELDS are encrypt()'d, everything else is plain. */
  settings: Record<string, string>;
  webhookRegistered: boolean;
  /** Provider-derived or provider-required extras: telegram botUsername (plain) + secretToken (encrypted). */
  extra: Record<string, string>;
}

function defaults(): StoredInboundChannel {
  return { enabled: false, settings: {}, webhookRegistered: false, extra: {} };
}

/** Decrypted settings for internal adapter/pipeline use. */
export interface ChannelSettings {
  channel: InboundChannel;
  enabled: boolean;
  settings: Record<string, string>;
  webhookRegistered: boolean;
  extra: Record<string, string>;
  updatedAt: string | null;
}

function getStored(db: Db, channel: InboundChannel): { value: StoredInboundChannel; updatedAt: string | null } {
  const repo = new SettingsRepo(db);
  const stored = repo.get<StoredInboundChannel>(settingsKey(channel));
  return { value: { ...defaults(), ...(stored?.value ?? {}) }, updatedAt: stored?.updatedAt ?? null };
}

export function getChannelSettings(db: Db, channel: InboundChannel): ChannelSettings {
  const { value, updatedAt } = getStored(db, channel);
  const secretFields = new Set(SECRET_FIELDS[channel]);
  const settings: Record<string, string> = {};
  for (const [k, v] of Object.entries(value.settings)) settings[k] = secretFields.has(k) ? decrypt(v) : v;
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(value.extra ?? {})) extra[k] = k === "secretToken" ? decrypt(v) : v;
  return { channel, enabled: value.enabled, settings, webhookRegistered: !!value.webhookRegistered, extra, updatedAt };
}

/** True when the channel has the minimum settings needed to receive/send messages. */
export function isChannelConfigured(settings: ChannelSettings): boolean {
  if (settings.channel === "twilio") return !!(settings.settings.accountSid && settings.settings.authToken && settings.settings.fromNumber);
  if (settings.channel === "telegram") return !!settings.settings.botToken;
  return true; // test channel needs no settings
}

/** Merge an update; masked placeholders leave the stored secret untouched, "" clears the field. */
export function saveChannelSettings(db: Db, channel: InboundChannel, input: { enabled?: boolean; settings: Record<string, string> }): void {
  const repo = new SettingsRepo(db);
  const current = getStored(db, channel).value;
  const secretFields = new Set(SECRET_FIELDS[channel]);
  const nextSettings: Record<string, string> = { ...current.settings };
  for (const [k, v] of Object.entries(input.settings)) {
    if (isMasked(v as unknown)) continue;
    if (v === "") {
      delete nextSettings[k];
      continue;
    }
    nextSettings[k] = secretFields.has(k) ? encrypt(v.trim()) : v.trim();
  }
  const next: StoredInboundChannel = {
    enabled: input.enabled ?? current.enabled,
    settings: nextSettings,
    webhookRegistered: current.webhookRegistered,
    extra: current.extra,
  };
  repo.set(settingsKey(channel), next);
}

/** Patches provider-derived state (webhookRegistered, botUsername, secretToken) without touching user-entered settings. */
export function setChannelExtra(
  db: Db,
  channel: InboundChannel,
  patch: { webhookRegistered?: boolean; extra?: Record<string, string> }
): void {
  const repo = new SettingsRepo(db);
  const current = getStored(db, channel).value;
  const secretFields = new Set(["secretToken"]);
  const nextExtra: Record<string, string> = { ...current.extra };
  for (const [k, v] of Object.entries(patch.extra ?? {})) {
    nextExtra[k] = secretFields.has(k) ? encrypt(v) : v;
  }
  const next: StoredInboundChannel = {
    enabled: current.enabled,
    settings: current.settings,
    webhookRegistered: patch.webhookRegistered ?? current.webhookRegistered,
    extra: nextExtra,
  };
  repo.set(settingsKey(channel), next);
}

export function deleteChannelSettings(db: Db, channel: InboundChannel): void {
  new SettingsRepo(db).delete(settingsKey(channel));
}

/** Where the provider must deliver events. Telegram's path only resolves once a secret token exists. */
export function webhookUrlFor(channel: InboundChannel, telegramSecretToken?: string): string {
  const base = (config.publicBaseUrl || config.clientUrl || "").replace(/\/+$/, "");
  if (channel === "twilio") return `${base}/api/inbound/twilio`;
  if (channel === "telegram") return `${base}/api/inbound/telegram/${telegramSecretToken || "<secret>"}`;
  return `${base}/api/inbound/test`;
}

/** Public view returned by the API: secrets masked. */
export function publicChannelConfig(db: Db, channel: InboundChannel): InboundChannelConfig {
  const { value, updatedAt } = getStored(db, channel);
  const secretFields = new Set(SECRET_FIELDS[channel]);
  const settings: Record<string, string> = {};
  for (const [k, v] of Object.entries(value.settings)) settings[k] = secretFields.has(k) ? mask(decrypt(v)) : v;
  if (channel === "telegram" && value.extra?.botUsername) settings.botUsername = value.extra.botUsername;
  return {
    channel,
    enabled: value.enabled,
    webhookUrl: webhookUrlFor(channel, channel === "telegram" ? decrypt(value.extra?.secretToken) || undefined : undefined),
    settings,
    webhookRegistered: channel === "telegram" ? !!value.webhookRegistered : undefined,
    updatedAt,
  };
}
