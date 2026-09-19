import type { AiProvider, AiSettings } from "@socmedia/shared";
import type { AiSettingsUpdateInput } from "@socmedia/shared";
import { config } from "../config";
import { decrypt, encrypt, isMasked, mask } from "../crypto";
import type { Db } from "../db/database";
import { SettingsRepo } from "../db/repositories/settings";

const KEY = "ai";
export const MOONSHOT_DEFAULT_BASE_URL = "https://api.moonshot.ai/v1";
export const MOONSHOT_DEFAULT_MODEL = "kimi-k3";

/** Shape persisted in app_settings (secrets encrypted at rest). */
interface StoredAiSettings {
  provider: AiProvider;
  anthropic: { apiKey: string; model: string };
  moonshot: { apiKey: string; model: string; baseUrl: string };
}

/** Resolved, decrypted settings for internal use. */
export interface ResolvedAiSettings extends AiSettings {
  anthropic: { apiKey: string; model: string };
  moonshot: { apiKey: string; model: string; baseUrl: string };
}

function defaults(): StoredAiSettings {
  return {
    provider: config.anthropicApiKey ? "anthropic" : "mock",
    anthropic: { apiKey: "", model: config.anthropicModel },
    moonshot: { apiKey: "", model: MOONSHOT_DEFAULT_MODEL, baseUrl: MOONSHOT_DEFAULT_BASE_URL },
  };
}

/** Decrypted settings; the ANTHROPIC_API_KEY env var acts as a fallback when no key is saved. */
export function getAiSettings(db: Db): ResolvedAiSettings {
  const repo = new SettingsRepo(db);
  const stored = repo.get<StoredAiSettings>(KEY);
  const base = { ...defaults(), ...(stored?.value ?? {}) };
  const savedAnthropicKey = decrypt(base.anthropic.apiKey);
  const anthropicFromEnv = !savedAnthropicKey && !!config.anthropicApiKey;
  return {
    provider: base.provider,
    anthropic: { apiKey: savedAnthropicKey || config.anthropicApiKey, model: base.anthropic.model || config.anthropicModel },
    moonshot: {
      apiKey: decrypt(base.moonshot.apiKey),
      model: base.moonshot.model || MOONSHOT_DEFAULT_MODEL,
      baseUrl: (base.moonshot.baseUrl || MOONSHOT_DEFAULT_BASE_URL).replace(/\/+$/, ""),
    },
    anthropicFromEnv,
    updatedAt: stored?.updatedAt ?? null,
  };
}

/** Settings safe to return to the client: secrets masked. */
export function getPublicAiSettings(db: Db): AiSettings {
  const s = getAiSettings(db);
  return {
    provider: s.provider,
    anthropic: { apiKey: mask(s.anthropic.apiKey), model: s.anthropic.model },
    moonshot: { apiKey: mask(s.moonshot.apiKey), model: s.moonshot.model, baseUrl: s.moonshot.baseUrl },
    anthropicFromEnv: s.anthropicFromEnv,
    updatedAt: s.updatedAt,
  };
}

/** Merge an update; masked placeholders leave the stored secret untouched, "" clears it. */
export function saveAiSettings(db: Db, input: AiSettingsUpdateInput): AiSettings {
  const repo = new SettingsRepo(db);
  const current = { ...defaults(), ...(repo.get<StoredAiSettings>(KEY)?.value ?? {}) };
  const next: StoredAiSettings = {
    provider: input.provider ?? current.provider,
    anthropic: {
      apiKey: resolveSecret(current.anthropic.apiKey, input.anthropic?.apiKey),
      model: input.anthropic?.model?.trim() || current.anthropic.model,
    },
    moonshot: {
      apiKey: resolveSecret(current.moonshot.apiKey, input.moonshot?.apiKey),
      model: input.moonshot?.model?.trim() || current.moonshot.model,
      baseUrl: input.moonshot?.baseUrl?.trim() || current.moonshot.baseUrl,
    },
  };
  repo.set(KEY, next);
  return getPublicAiSettings(db);
}

function resolveSecret(currentEncrypted: string, incoming: string | undefined): string {
  if (incoming === undefined) return currentEncrypted;
  if (isMasked(incoming as unknown)) return currentEncrypted;
  return encrypt(incoming.trim());
}

/** The provider that will actually serve requests right now (falls back to mock when the chosen provider has no key). */
export function activeProvider(db: Db): { provider: AiProvider; model: string; apiKey: string; baseUrl?: string } {
  const s = getAiSettings(db);
  if (s.provider === "anthropic" && s.anthropic.apiKey) return { provider: "anthropic", model: s.anthropic.model, apiKey: s.anthropic.apiKey };
  if (s.provider === "moonshot" && s.moonshot.apiKey) return { provider: "moonshot", model: s.moonshot.model, apiKey: s.moonshot.apiKey, baseUrl: s.moonshot.baseUrl };
  return { provider: "mock", model: "offline-mock", apiKey: "" };
}
