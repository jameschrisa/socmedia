import type { AgentAction, Post, PublishJob } from "@socmedia/shared";
import type { AgentToolContext } from "./agentTools";
import { runTool } from "./agentTools";

/**
 * Deterministic offline fallback used when no AI provider is configured. Pattern-matches a handful
 * of common intents so the console is still useful without an API key.
 */
export async function runMockAgent(ctx: AgentToolContext, input: string): Promise<{ reply: string; actions: AgentAction[] }> {
  const lower = input.trim().toLowerCase();
  const actions: AgentAction[] = [];

  const runAndTrack = async (tool: string, toolInput: Record<string, unknown>) => {
    const result = await runTool(ctx, tool, toolInput);
    actions.push({ tool, input: toolInput, ok: result.ok, summary: result.summary });
    return result;
  };

  if (/\blist posts\b/.test(lower) || lower === "posts" || /\bshow (me )?(the )?posts\b/.test(lower)) {
    const result = await runAndTrack("list_posts", {});
    const posts = (result.data as Post[]) ?? [];
    if (posts.length === 0) return { reply: "No posts yet.", actions };
    const lines = posts.slice(0, 10).map((p) => `- ${p.id}: "${p.title || "(untitled)"}" [${p.status}]`);
    return { reply: `You have ${posts.length} post(s):\n${lines.join("\n")}`, actions };
  }

  if (/what.*failed|failed jobs?|anything fail/.test(lower)) {
    const result = await runAndTrack("list_jobs", { status: "failed" });
    const jobs = (result.data as PublishJob[]) ?? [];
    if (jobs.length === 0) return { reply: "Nothing has failed recently.", actions };
    const lines = jobs.slice(0, 10).map((j) => `- job ${j.id} (post ${j.postId}, ${j.platform}): ${j.error ?? "unknown error"}`);
    return { reply: `${jobs.length} failed job(s):\n${lines.join("\n")}`, actions };
  }

  const scheduleMatch = lower.match(/schedule\s+(?:post\s+)?([a-z0-9_-]+)\s+(?:for|at)\s+(.+)/i);
  if (scheduleMatch) {
    const [, id, when] = scheduleMatch;
    const scheduledAt = new Date(when.trim());
    if (Number.isNaN(scheduledAt.getTime())) {
      return { reply: `I couldn't parse "${when.trim()}" as a date/time. Try an ISO datetime like 2026-09-25T15:00:00Z.`, actions };
    }
    const result = await runAndTrack("schedule_post", { id, scheduledAt: scheduledAt.toISOString() });
    return { reply: result.summary, actions };
  }
  if (/^schedule\b/.test(lower)) {
    return {
      reply: 'To schedule a post without an AI provider, say something like "schedule post <id> for 2026-09-25T15:00:00Z".',
      actions,
    };
  }

  const publishMatch = lower.match(/\bpublish\s+(?:post\s+)?([a-z0-9_-]+)/i);
  if (publishMatch) {
    const result = await runAndTrack("publish_post", { id: publishMatch[1] });
    return { reply: result.summary, actions };
  }

  return {
    reply:
      "I need an AI provider configured (Settings → AI) to understand free-form requests. " +
      'Try a slash command like /help, /status or /posts, or ask me to "list posts", "what failed", or "publish <postId>".',
    actions,
  };
}
