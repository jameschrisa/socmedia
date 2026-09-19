import Anthropic from "@anthropic-ai/sdk";
import type { AgentAction } from "@socmedia/shared";
import { HttpError } from "../middleware/errors";
import type { AgentToolContext } from "./agentTools";
import { runTool, TOOL_DEFINITIONS } from "./agentTools";

const MAX_ITERATIONS = 8;
const MAX_REPLY_CHARS = 1500;
const STEP_LIMIT_REPLY = "I reached the step limit for this request without finishing everything. Try breaking it into smaller steps.";

function trimReply(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Done.";
  return trimmed.length > MAX_REPLY_CHARS ? `${trimmed.slice(0, MAX_REPLY_CHARS - 1)}…` : trimmed;
}

/** Anthropic tool-use loop: calls messages.create, executes any tool_use blocks, and repeats until end_turn. */
export async function runAnthropicAgent(
  apiKey: string,
  model: string,
  system: string,
  input: string,
  ctx: AgentToolContext
): Promise<{ reply: string; actions: AgentAction[] }> {
  const client = new Anthropic({ apiKey });
  const actions: AgentAction[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: "user", content: input }];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let response;
    try {
      response = await client.messages.create({
        model,
        max_tokens: 1500,
        system,
        messages,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: TOOL_DEFINITIONS as any,
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new HttpError(502, "Anthropic rejected the API key.");
      if (err instanceof Anthropic.RateLimitError) throw new HttpError(502, "Anthropic rate limit exceeded. Try again shortly.");
      if (err instanceof Anthropic.APIError) throw new HttpError(502, `Anthropic error: ${err.message}`);
      throw new HttpError(502, err instanceof Error ? err.message : "Anthropic agent request failed");
    }

    const content: any[] = response.content ?? [];
    const toolUses = content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      const text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      return { reply: trimReply(text), actions };
    }

    messages.push({ role: "assistant", content });
    const toolResults = [];
    for (const block of toolUses) {
      const result = await runTool(ctx, block.name, block.input);
      actions.push({ tool: block.name, input: (block.input as Record<string, unknown>) ?? {}, ok: result.ok, summary: result.summary });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result.data !== undefined ? result.data : result.summary),
        is_error: !result.ok,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { reply: STEP_LIMIT_REPLY, actions };
}

interface MoonshotToolCall {
  id: string;
  function?: { name: string; arguments?: string };
}

interface MoonshotMessage {
  role: string;
  content?: string | null;
  tool_calls?: MoonshotToolCall[];
  tool_call_id?: string;
}

interface MoonshotChatResponse {
  choices?: { message?: MoonshotMessage }[];
  error?: { message?: string };
}

/** Moonshot (Kimi) tool-use loop via its OpenAI-compatible function-calling API. */
export async function runMoonshotAgent(
  apiKey: string,
  baseUrl: string,
  model: string,
  system: string,
  input: string,
  ctx: AgentToolContext
): Promise<{ reply: string; actions: AgentAction[] }> {
  const actions: AgentAction[] = [];
  const messages: MoonshotMessage[] = [
    { role: "system", content: system },
    { role: "user", content: input },
  ];
  const tools = TOOL_DEFINITIONS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, tools, tool_choice: "auto", temperature: 0.4 }),
      });
    } catch (err) {
      throw new HttpError(502, `Could not reach Moonshot API: ${err instanceof Error ? err.message : String(err)}`);
    }
    const json = (await res.json().catch(() => ({}))) as MoonshotChatResponse;
    if (res.status === 401) throw new HttpError(502, "Moonshot rejected the API key.");
    if (!res.ok) throw new HttpError(502, `Moonshot error: ${json.error?.message ?? res.statusText}`);
    const message = json.choices?.[0]?.message;
    if (!message) throw new HttpError(502, "Moonshot returned an empty response.");

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return { reply: trimReply(message.content ?? ""), actions };
    }

    messages.push(message);
    for (const call of toolCalls) {
      const name = call.function?.name ?? "";
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(call.function?.arguments ?? "{}");
      } catch {
        parsedArgs = {};
      }
      const result = await runTool(ctx, name, parsedArgs);
      actions.push({ tool: name, input: parsedArgs, ok: result.ok, summary: result.summary });
      messages.push({
        role: "tool",
        content: JSON.stringify(result.data !== undefined ? result.data : result.summary),
        tool_call_id: call.id,
      });
    }
  }

  return { reply: STEP_LIMIT_REPLY, actions };
}
