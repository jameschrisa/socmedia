import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { toJSONSchema, type z } from "zod/v4";
import type { AiProviderTestResult } from "@socmedia/shared";
import type { Db } from "../db/database";
import { HttpError } from "../middleware/errors";
import { activeProvider, getAiSettings } from "./aiSettings";

export interface StructuredRequest<S extends z.ZodType> {
  schema: S;
  schemaName: string;
  system: string;
  user: string;
  maxTokens: number;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  provider: "anthropic" | "moonshot";
}

/**
 * Run a structured-output request against whichever provider is active.
 * Anthropic: native structured outputs via messages.parse.
 * Moonshot (Kimi): OpenAI-compatible chat completions with JSON mode, validated with zod.
 */
export async function structured<S extends z.ZodType>(db: Db, req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
  const active = activeProvider(db);
  if (active.provider === "anthropic") return anthropicStructured(active.apiKey, active.model, req);
  if (active.provider === "moonshot") return moonshotStructured(active.apiKey, active.baseUrl!, active.model, req);
  throw new HttpError(503, "No AI provider is configured.");
}

async function anthropicStructured<S extends z.ZodType>(apiKey: string, model: string, req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.parse({
      model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      output_config: { format: zodOutputFormat(req.schema as any), effort: "medium" },
    });
    if (response.stop_reason === "refusal") throw new HttpError(502, "The AI model declined to generate this content.");
    const parsed = response.parsed_output as z.infer<S> | null;
    if (!parsed) throw new HttpError(502, "The AI model returned no structured output.");
    return { data: parsed, model, provider: "anthropic" };
  } catch (err) {
    handleAnthropicError(err);
  }
}

function handleAnthropicError(err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError) throw new HttpError(502, "Anthropic rejected the API key.");
  if (err instanceof Anthropic.RateLimitError) throw new HttpError(502, "Anthropic rate limit exceeded. Try again shortly.");
  if (err instanceof Anthropic.NotFoundError) throw new HttpError(502, `Anthropic model not found: ${err.message}`);
  if (err instanceof Anthropic.APIError) throw new HttpError(502, `Anthropic error: ${err.message}`);
  if (err instanceof HttpError) throw err;
  throw new HttpError(502, err instanceof Error ? err.message : "AI request failed");
}

/** Convert a zod v4 schema to JSON schema for prompting Kimi. */
function jsonSchemaOf(schema: z.ZodType): unknown {
  return toJSONSchema(schema);
}

interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  error?: { message?: string; type?: string };
}

async function moonshotStructured<S extends z.ZodType>(apiKey: string, baseUrl: string, model: string, req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
  const schemaJson = JSON.stringify(jsonSchemaOf(req.schema));
  const body = {
    model,
    temperature: 0.6,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${req.system}\n\nRespond ONLY with a JSON object that validates against this JSON Schema (no prose, no markdown):\n${schemaJson}` },
      { role: "user", content: req.user },
    ],
  };
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new HttpError(502, `Could not reach Moonshot API: ${err instanceof Error ? err.message : String(err)}`);
  }
  const json = (await res.json().catch(() => ({}))) as ChatCompletionResponse;
  if (res.status === 401) throw new HttpError(502, "Moonshot rejected the API key.");
  if (res.status === 429) throw new HttpError(502, "Moonshot rate limit exceeded. Try again shortly.");
  if (res.status === 404) throw new HttpError(502, `Moonshot model not found: ${model}`);
  if (!res.ok) throw new HttpError(502, `Moonshot error: ${json.error?.message ?? res.statusText}`);
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new HttpError(502, "Moonshot returned an empty response.");
  let raw: unknown;
  try {
    raw = JSON.parse(stripFences(content));
  } catch {
    throw new HttpError(502, "Moonshot returned invalid JSON.");
  }
  const parsed = req.schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(502, "Moonshot response did not match the expected shape.", parsed.error.issues);
  return { data: parsed.data as z.infer<S>, model: json.model ?? model, provider: "moonshot" };
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
}

/** Connectivity + credential check for a provider, independent of which one is active. */
export async function testProvider(db: Db, provider: "anthropic" | "moonshot"): Promise<AiProviderTestResult> {
  const s = getAiSettings(db);
  const started = Date.now();
  if (provider === "anthropic") {
    if (!s.anthropic.apiKey) return { ok: false, provider, model: s.anthropic.model, latencyMs: 0, message: "No Anthropic API key saved." };
    try {
      const client = new Anthropic({ apiKey: s.anthropic.apiKey });
      const info = await client.models.retrieve(s.anthropic.model);
      return { ok: true, provider, model: s.anthropic.model, latencyMs: Date.now() - started, message: `Authenticated. Model available: ${info.display_name ?? info.id}.` };
    } catch (err) {
      return { ok: false, provider, model: s.anthropic.model, latencyMs: Date.now() - started, message: describeAnthropicError(err) };
    }
  }
  if (!s.moonshot.apiKey) return { ok: false, provider, model: s.moonshot.model, latencyMs: 0, message: "No Moonshot API key saved." };
  try {
    const res = await fetch(`${s.moonshot.baseUrl}/models`, { headers: { Authorization: `Bearer ${s.moonshot.apiKey}` } });
    if (res.status === 401) return { ok: false, provider, model: s.moonshot.model, latencyMs: Date.now() - started, message: "Moonshot rejected the API key." };
    if (!res.ok) return { ok: false, provider, model: s.moonshot.model, latencyMs: Date.now() - started, message: `Moonshot responded with HTTP ${res.status}.` };
    const json = (await res.json().catch(() => ({}))) as { data?: { id: string }[] };
    const ids = (json.data ?? []).map((m) => m.id);
    const known = ids.length === 0 || ids.includes(s.moonshot.model);
    return {
      ok: known,
      provider,
      model: s.moonshot.model,
      latencyMs: Date.now() - started,
      message: known ? `Authenticated. ${ids.length ? `${ids.length} models available.` : ""}`.trim() : `Authenticated, but model "${s.moonshot.model}" is not in the account's model list.`,
    };
  } catch (err) {
    return { ok: false, provider, model: s.moonshot.model, latencyMs: Date.now() - started, message: `Could not reach Moonshot API: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function describeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Anthropic rejected the API key.";
  if (err instanceof Anthropic.NotFoundError) return "Authenticated, but the model id was not found.";
  if (err instanceof Anthropic.APIError) return `Anthropic error: ${err.message}`;
  return err instanceof Error ? err.message : "Unknown error";
}

/** List model ids a provider exposes for the saved key. */
export async function listModels(db: Db, provider: "anthropic" | "moonshot"): Promise<string[]> {
  const s = getAiSettings(db);
  if (provider === "anthropic") {
    if (!s.anthropic.apiKey) throw new HttpError(400, "No Anthropic API key saved.");
    try {
      const client = new Anthropic({ apiKey: s.anthropic.apiKey });
      const ids: string[] = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids;
    } catch (err) {
      handleAnthropicError(err);
    }
  }
  if (!s.moonshot.apiKey) throw new HttpError(400, "No Moonshot API key saved.");
  const res = await fetch(`${s.moonshot.baseUrl}/models`, { headers: { Authorization: `Bearer ${s.moonshot.apiKey}` } }).catch((err: Error) => {
    throw new HttpError(502, `Could not reach Moonshot API: ${err.message}`);
  });
  if (!res.ok) throw new HttpError(502, `Moonshot responded with HTTP ${res.status}.`);
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id);
}
