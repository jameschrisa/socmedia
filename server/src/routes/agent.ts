import { Router } from "express";
import { nanoid } from "nanoid";
import { PLATFORMS, agentCommandSchema, type AgentAction, type AgentCommandResult, type Platform, type PlatformDocHit } from "@socmedia/shared";
import { config } from "../config";
import type { Db } from "../db/database";
import { activeProvider } from "../services/aiSettings";
import { runMockAgent } from "../services/agentMock";
import { runAnthropicAgent, runMoonshotAgent } from "../services/agentRuntime";
import type { AgentToolContext, DiagnoseConnectionData } from "../services/agentTools";
import { runTool } from "../services/agentTools";
import { log } from "../services/logger";
import { platformDocsStatus, searchPlatformDocs } from "../services/platformDocs";
import { asyncHandler } from "../utils/asyncHandler";

function systemPrompt(ctx: AgentToolContext): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `You are suprstar's operator console assistant for the "${ctx.org.name}" social media workspace.`,
    `Today's date is ${today}. The organization's timezone is ${ctx.org.timezone}.`,
    "Use the provided tools to look up real data before answering; never invent post, job, media, account or user ids.",
    "When you make a change, confirm exactly what changed and include the relevant id(s).",
    "When a user reports a connection, account or publishing problem: first inspect the relevant connection " +
      "(list_accounts, diagnose_connection, recent_logs, list_jobs), then call platform_docs with the exact error " +
      "string before answering. Cite the doc file and its source URL in your reply.",
    "Keep replies concise (a few sentences or a short list) and don't restate raw tool output verbatim.",
  ].join("\n");
}

const KNOWN_LEVELS = new Set(["debug", "info", "warn", "error"]);

/** Fast, exact built-in commands handled without any AI call. */
async function handleSlashCommand(ctx: AgentToolContext, raw: string): Promise<{ reply: string; actions: AgentAction[] }> {
  const parts = raw.slice(1).split(/\s+/).filter(Boolean);
  const cmd = (parts[0] ?? "").toLowerCase();
  const args = parts.slice(1);
  const actions: AgentAction[] = [];

  const runAndTrack = async (tool: string, toolInput: Record<string, unknown>) => {
    const result = await runTool(ctx, tool, toolInput);
    actions.push({ tool, input: toolInput, ok: result.ok, summary: result.summary });
    return result;
  };

  switch (cmd) {
    case "help":
      return {
        reply: [
          "Available commands:",
          "/help: show this list",
          "/status: scheduler + post/job/account counts",
          "/posts [status]: list posts",
          "/jobs [failed|queued]: list publish jobs",
          "/accounts: list connected accounts",
          "/media: list media assets",
          "/publish <postId>: publish a post now (write role)",
          "/retry <jobId>: retry a failed job (write role)",
          "/logs [level] [n]: recent log lines",
          "/docs <platform?> <query>: search the platform developer-docs knowledge base",
          "/diagnose <connectionId|platform>: bundle a connection's status, last test, recent jobs and doc hits",
          "/whoami: show your account",
          "Anything else is sent to the AI agent.",
        ].join("\n"),
        actions,
      };

    case "status": {
      const postsResult = await runAndTrack("list_posts", { limit: 1000 });
      const posts = (postsResult.data as { status: string }[]) ?? [];
      const counts = new Map<string, number>();
      for (const p of posts) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
      const accountsResult = await runAndTrack("list_accounts", {});
      const accounts = (accountsResult.data as { enabled: boolean }[]) ?? [];
      const enabled = accounts.filter((a) => a.enabled).length;
      const countsLine = [...counts.entries()].map(([s, n]) => `${s}=${n}`).join(", ") || "none";
      return {
        reply: [
          `Scheduler: ticking every ${Math.round(config.schedulerIntervalMs / 1000)}s.`,
          `Posts (${posts.length} total): ${countsLine}`,
          `Accounts: ${enabled}/${accounts.length} enabled.`,
        ].join("\n"),
        actions,
      };
    }

    case "posts": {
      const status = args[0];
      const result = await runAndTrack("list_posts", status ? { status } : {});
      const posts = (result.data as { id: string; title: string; status: string }[]) ?? [];
      if (posts.length === 0) return { reply: "No posts found.", actions };
      return { reply: posts.map((p) => `${p.id}  ${p.status.padEnd(20)}  ${p.title || "(untitled)"}`).join("\n"), actions };
    }

    case "jobs": {
      const status = args[0];
      const result = await runAndTrack("list_jobs", status ? { status } : {});
      const jobs = (result.data as { id: string; status: string; platform: string; postId: string; error?: string | null }[]) ?? [];
      if (jobs.length === 0) return { reply: "No jobs found.", actions };
      return {
        reply: jobs
          .map((j) => `${j.id}  ${j.status.padEnd(10)}  ${j.platform.padEnd(10)}  post=${j.postId}${j.error ? `  error=${j.error}` : ""}`)
          .join("\n"),
        actions,
      };
    }

    case "accounts": {
      const result = await runAndTrack("list_accounts", {});
      const accounts = (result.data as { platform: string; label: string; enabled: boolean; status: string }[]) ?? [];
      if (accounts.length === 0) return { reply: "No accounts configured.", actions };
      return {
        reply: accounts
          .map((a) => `${a.platform.padEnd(10)} ${(a.label || "(default)").padEnd(16)} ${a.status}${a.enabled ? "" : " (disabled)"}`)
          .join("\n"),
        actions,
      };
    }

    case "media": {
      const result = await runAndTrack("list_media", {});
      const media = (result.data as { id: string; kind: string; filename: string }[]) ?? [];
      if (media.length === 0) return { reply: "No media uploaded yet.", actions };
      return { reply: media.slice(0, 20).map((m) => `${m.id}  ${m.kind.padEnd(6)} ${m.filename}`).join("\n"), actions };
    }

    case "publish": {
      const id = args[0];
      if (!id) return { reply: "Usage: /publish <postId>", actions };
      const result = await runAndTrack("publish_post", { id });
      return { reply: result.summary, actions };
    }

    case "retry": {
      const id = args[0];
      if (!id) return { reply: "Usage: /retry <jobId>", actions };
      const result = await runAndTrack("retry_job", { id });
      return { reply: result.summary, actions };
    }

    case "logs": {
      const level = args[0] && KNOWN_LEVELS.has(args[0].toLowerCase()) ? args[0].toLowerCase() : undefined;
      const nArg = args.find((a) => /^\d+$/.test(a));
      const limit = nArg ? Number(nArg) : 20;
      const result = await runAndTrack("recent_logs", level ? { level, limit } : { limit });
      const entries = (result.data as { at: string; level: string; source: string; message: string }[]) ?? [];
      if (entries.length === 0) return { reply: "No log entries yet.", actions };
      return { reply: entries.map((e) => `${e.at}  ${e.level.padEnd(5)} ${e.source.padEnd(10)} ${e.message}`).join("\n"), actions };
    }

    case "docs": {
      if (args.length === 0) return { reply: "Usage: /docs <platform?> <query>", actions };
      let platform: string | undefined;
      let queryArgs = args;
      if (PLATFORMS.includes(args[0].toLowerCase() as Platform)) {
        platform = args[0].toLowerCase();
        queryArgs = args.slice(1);
      }
      const query = queryArgs.join(" ").trim();
      if (!query) return { reply: "Usage: /docs <platform?> <query>", actions };
      const result = await runAndTrack("platform_docs", platform ? { platform, query } : { query });
      const hits = (result.data as PlatformDocHit[]) ?? [];
      if (hits.length === 0) return { reply: `No doc hits for "${query}".`, actions };
      return {
        reply: hits
          .map((h, i) => `${i + 1}. [${h.platform}] ${h.file} — ${h.heading}${h.sources[0] ? ` (${h.sources[0]})` : ""}`)
          .join("\n"),
        actions,
      };
    }

    case "diagnose": {
      const arg = args[0];
      if (!arg) return { reply: "Usage: /diagnose <connectionId|platform>", actions };
      let connectionId = arg;
      if (PLATFORMS.includes(arg.toLowerCase() as Platform)) {
        const accountsResult = await runAndTrack("list_accounts", {});
        const accounts = (accountsResult.data as { id: string; platform: string }[]) ?? [];
        const match = accounts.find((a) => a.platform === arg.toLowerCase());
        if (!match) return { reply: `No account found for platform "${arg}".`, actions };
        connectionId = match.id;
      }
      const result = await runAndTrack("diagnose_connection", { connectionId });
      if (!result.ok) return { reply: result.summary, actions };
      const data = result.data as DiagnoseConnectionData;
      const lines = [
        `${data.connection.platform} "${data.connection.label || data.connection.displayName}": ${data.connection.status} (${data.connection.mode})`,
        `Scopes: ${data.connection.scopes.join(", ") || "none"}. Token expires: ${data.connection.tokenExpiresAt ?? "n/a"}. Access token: ${
          data.connection.accessTokenMasked || "none"
        }.`,
        data.lastTest ? `Last test: ${data.lastTest.ok ? "ok" : "FAILED"} — ${data.lastTest.message}` : "Last test: never run.",
        data.recentJobs.length === 0
          ? "Recent jobs: none."
          : `Recent jobs: ${data.recentJobs.map((j) => `${j.status}${j.error ? ` (${j.error})` : ""}`).join(", ")}`,
      ];
      if (data.docHits.length > 0) {
        lines.push("Top doc matches:");
        for (const h of data.docHits) lines.push(`- ${h.file} — ${h.heading}${h.sources[0] ? ` (${h.sources[0]})` : ""}`);
      }
      return { reply: lines.join("\n"), actions };
    }

    case "whoami":
      return {
        reply: `${ctx.user.name} <${ctx.user.email}>: role: ${ctx.user.role}: orgs: ${
          ctx.user.orgIds === "*" ? "all" : ctx.user.orgIds.join(", ") || "none"
        }`,
        actions,
      };

    default:
      return { reply: `Unknown command "/${cmd}". Try /help.`, actions };
  }
}

/**
 * Runs one agent command (slash command or free-text AI request) for `ctx` and returns the reply.
 * Shared by the console's `POST /api/agent/commands` route and inbound chat messaging's "/" commands
 * (services/inbound.ts), so both surfaces stay behind the exact same command handling.
 */
export async function executeAgentCommand(
  ctx: AgentToolContext,
  rawInput: string
): Promise<{ reply: string; actions: AgentAction[]; model: string; mock: boolean }> {
  const trimmed = rawInput.trim();
  let reply: string;
  let actions: AgentAction[];
  let model = "slash-command";
  let mock = false;

  if (trimmed.startsWith("/")) {
    const result = await handleSlashCommand(ctx, trimmed);
    reply = result.reply;
    actions = result.actions;
  } else {
    const active = activeProvider(ctx.db);
    model = active.model;
    mock = active.provider === "mock";
    if (active.provider === "anthropic") {
      const result = await runAnthropicAgent(active.apiKey, active.model, systemPrompt(ctx), trimmed, ctx);
      reply = result.reply;
      actions = result.actions;
    } else if (active.provider === "moonshot") {
      const result = await runMoonshotAgent(active.apiKey, active.baseUrl!, active.model, systemPrompt(ctx), trimmed, ctx);
      reply = result.reply;
      actions = result.actions;
    } else {
      const result = await runMockAgent(ctx, trimmed);
      reply = result.reply;
      actions = result.actions;
    }
  }

  return { reply, actions, model, mock };
}

/** Org-scoped console command endpoint: fast built-in slash commands, or a tool-using AI agent. */
export function agentRouter(db: Db): Router {
  const router = Router();

  router.post(
    "/commands",
    asyncHandler(async (req, res) => {
      const { input } = agentCommandSchema.parse(req.body);
      const trimmed = input.trim();
      const ctx: AgentToolContext = { db, org: req.org!, user: req.user! };

      const { reply, actions, model, mock } = await executeAgentCommand(ctx, trimmed);

      const result: AgentCommandResult = {
        id: nanoid(),
        input: trimmed,
        reply,
        actions,
        model,
        mock,
        at: new Date().toISOString(),
      };
      log.info("agent", `Command: ${trimmed}`, {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        data: { tools: actions.map((a) => a.tool), mock },
      });
      res.json(result);
    })
  );

  return router;
}

/**
 * `GET /api/docs/platforms/search` and `GET /api/docs/platforms/status` (signed-in, not org-scoped):
 * the same knowledge base `platform_docs` searches, exposed for the client's Documentation panel.
 */
export function platformDocsRouter(_db: Db): Router {
  const router = Router();

  router.get(
    "/search",
    asyncHandler(async (req, res) => {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (!q) {
        res.json({ hits: [] });
        return;
      }
      const platform = typeof req.query.platform === "string" && req.query.platform ? req.query.platform : undefined;
      const limitRaw = req.query.limit;
      const limit = typeof limitRaw === "string" && /^\d+$/.test(limitRaw) ? Math.min(20, Math.max(1, Number(limitRaw))) : 5;
      const hits = searchPlatformDocs({ platform, query: q, limit });
      res.json({ hits });
    })
  );

  router.get(
    "/status",
    asyncHandler(async (_req, res) => {
      res.json(platformDocsStatus());
    })
  );

  return router;
}
