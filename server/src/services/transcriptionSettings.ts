import { decrypt, encrypt, isMasked, mask } from "../crypto";
import type { Db } from "../db/database";
import { SettingsRepo } from "../db/repositories/settings";

const KEY = "transcription";

export type TranscriptionProvider = "none" | "openai" | "deepgram";

interface StoredTranscriptionSettings {
  provider: TranscriptionProvider;
  apiKey: string; // encrypted
}

export interface ResolvedTranscriptionSettings {
  provider: TranscriptionProvider;
  apiKey: string;
  updatedAt: string | null;
}

export interface PublicTranscriptionSettings {
  provider: TranscriptionProvider;
  apiKey: string; // masked
  /** True when a provider other than none has a key, so voice notes can be transcribed. */
  configured: boolean;
  updatedAt: string | null;
}

function defaults(): StoredTranscriptionSettings {
  return { provider: "none", apiKey: "" };
}

export function getTranscriptionSettings(db: Db): ResolvedTranscriptionSettings {
  const repo = new SettingsRepo(db);
  const stored = repo.get<StoredTranscriptionSettings>(KEY);
  const base = { ...defaults(), ...(stored?.value ?? {}) };
  return { provider: base.provider, apiKey: decrypt(base.apiKey), updatedAt: stored?.updatedAt ?? null };
}

export function getPublicTranscriptionSettings(db: Db): PublicTranscriptionSettings {
  const s = getTranscriptionSettings(db);
  return { provider: s.provider, apiKey: mask(s.apiKey), configured: s.provider !== "none" && !!s.apiKey, updatedAt: s.updatedAt };
}

export function saveTranscriptionSettings(db: Db, input: { provider: TranscriptionProvider; apiKey?: string }): PublicTranscriptionSettings {
  const repo = new SettingsRepo(db);
  const current = { ...defaults(), ...(repo.get<StoredTranscriptionSettings>(KEY)?.value ?? {}) };
  const next: StoredTranscriptionSettings = {
    provider: input.provider,
    apiKey:
      input.apiKey === undefined
        ? current.apiKey
        : isMasked(input.apiKey as unknown)
          ? current.apiKey
          : input.apiKey === ""
            ? ""
            : encrypt(input.apiKey.trim()),
  };
  repo.set(KEY, next);
  return getPublicTranscriptionSettings(db);
}

export function transcriptionConfigured(db: Db): boolean {
  const s = getTranscriptionSettings(db);
  return s.provider !== "none" && !!s.apiKey;
}
