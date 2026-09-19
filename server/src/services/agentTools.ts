import { nanoid } from "nanoid";
import { PLATFORM_SPECS, postInputSchema } from "@socmedia/shared";
import type { Organization, Platform, PostStatus, PostTarget, User } from "@socmedia/shared";
import type { Db } from "../db/database";
import { ConnectionsRepo } from "../db/repositories/connections";
import { JobsRepo } from "../db/repositories/jobs";
import { MediaRepo } from "../db/repositories/media";
import { PostsRepo } from "../db/repositories/posts";
import { summarize } from "./analytics";
import { generateCaptions } from "./ai";
import { log } from "./logger";
import { publishPost, retryJob } from "./publisher";

export interface AgentToolContext {
  db: Db;
  org: Organization;
  user: User;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
}

export type ToolHandler = (ctx: AgentToolContext, input: Record<string, unknown>) => Promise<ToolResult>;

/** Tools that mutate state; refused for viewers. */
export const WRITE_TOOLS = new Set(["create_post", "update_post", "schedule_post", "publish_post", "delete_post", "retry_job"]);

/** JSON Schema definitions shared by the Anthropic and Moonshot tool-use loops. */
export const TOOL_DEFINITIONS: { name: string; description: string; input_schema: Record<string, unknown> }[] = [
  {
    name: "list_posts",
    description: "List posts in the current organization, optionally filtered by status.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "draft|needs_approval|approved|scheduled|publishing|published|partially_published|failed" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_post",
    description: "Get full details of a single post by id.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "create_post",
    description: "Create a new post (draft, or scheduled if scheduledAt is given). Targets default to every enabled account for the given platforms.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        caption: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
        platforms: { type: "array", items: { type: "string" } },
        connectionIds: { type: "array", items: { type: "string" } },
        scheduledAt: { type: "string", description: "ISO 8601 datetime" },
        mediaIds: { type: "array", items: { type: "string" } },
      },
      required: ["title", "caption"],
    },
  },
  {
    name: "update_post",
    description: "Update fields on an existing post (title, caption, hashtags, mediaIds, scheduledAt, notes, labels).",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "schedule_post",
    description: "Schedule a post for a given ISO datetime.",
    input_schema: { type: "object", properties: { id: { type: "string" }, scheduledAt: { type: "string" } }, required: ["id", "scheduledAt"] },
  },
  {
    name: "publish_post",
    description: "Publish a post immediately through its target accounts.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "delete_post",
    description: "Delete a post.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "list_media",
    description: "List media assets, optionally filtered by kind (image|video) or tag.",
    input_schema: { type: "object", properties: { kind: { type: "string" }, tag: { type: "string" } } },
  },
  {
    name: "list_accounts",
    description: "List every connected platform account for the organization.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_jobs",
    description: "List publish jobs, optionally filtered by status (queued|running|succeeded|failed|cancelled).",
    input_schema: { type: "object", properties: { status: { type: "string" } } },
  },
  {
    name: "retry_job",
    description: "Retry a failed or stuck publish job.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "analytics_summary",
    description: "Get an analytics summary for the last 7 or 30 days.",
    input_schema: { type: "object", properties: { range: { type: "string", enum: ["7d", "30d"] } } },
  },
  {
    name: "generate_captions",
    description: "Generate on-brand caption variants for a brief across the given platforms.",
    input_schema: {
      type: "object",
      properties: { brief: { type: "string" }, platforms: { type: "array", items: { type: "string" } } },
      required: ["brief", "platforms"],
    },
  },
  {
    name: "recent_logs",
    description: "Read recent activity log entries.",
    input_schema: { type: "object", properties: { level: { type: "string" }, limit: { type: "number" } } },
  },
  {
    name: "search_posts",
    description: "Search posts by a substring of their title or caption.",
    input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  },
];

function buildTargets(ctx: AgentToolContext, platforms: Platform[] | undefined, connectionIds: string[] | undefined, mediaIds: string[]): PostTarget[] {
  const connectionsRepo = new ConnectionsRepo(ctx.db);
  const all = connectionsRepo.listByOrg(ctx.org.id).filter((c) => c.enabled);
  let chosen = all;
  if (connectionIds && connectionIds.length > 0) {
    const set = new Set(connectionIds);
    chosen = all.filter((c) => set.has(c.id));
  } else if (platforms && platforms.length > 0) {
    const set = new Set(platforms);
    chosen = all.filter((c) => set.has(c.platform));
  }
  return chosen.map((c) => ({
    platform: c.platform,
    connectionId: c.id,
    format: PLATFORM_SPECS[c.platform].formats[0],
    mediaIds,
  }));
}

function requireWriteRole(ctx: AgentToolContext, toolName: string): ToolResult | undefined {
  if (ctx.user.role === "viewer") {
    return { ok: false, summary: `Viewers cannot use "${toolName}". Ask an editor, admin or owner to do this.` };
  }
  return undefined;
}

/** Executes a single named tool call, scoped to the caller's org and role. */
export async function runTool(ctx: AgentToolContext, name: string, rawInput: unknown): Promise<ToolResult> {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  if (WRITE_TOOLS.has(name)) {
    const refusal = requireWriteRole(ctx, name);
    if (refusal) return refusal;
  }

  const postsRepo = new PostsRepo(ctx.db);
  const mediaRepo = new MediaRepo(ctx.db);
  const connectionsRepo = new ConnectionsRepo(ctx.db);
  const jobsRepo = new JobsRepo(ctx.db);

  switch (name) {
    case "list_posts": {
      const status = typeof input.status === "string" ? [input.status as PostStatus] : undefined;
      const posts = postsRepo.listByOrg(ctx.org.id, { status, includeUnscheduled: true });
      const limit = typeof input.limit === "number" ? input.limit : 20;
      const sliced = posts.slice(0, limit);
      return { ok: true, summary: `Found ${sliced.length} post(s).`, data: sliced };
    }
    case "get_post": {
      const post = postsRepo.get(String(input.id));
      if (!post || post.orgId !== ctx.org.id) return { ok: false, summary: `Post ${input.id} not found.` };
      return { ok: true, summary: `Post "${post.title || post.id}" (${post.status}).`, data: post };
    }
    case "create_post": {
      const platforms = Array.isArray(input.platforms) ? (input.platforms as Platform[]) : undefined;
      const mediaIds = Array.isArray(input.mediaIds) ? (input.mediaIds as string[]) : [];
      const connectionIds = Array.isArray(input.connectionIds) ? (input.connectionIds as string[]) : undefined;
      const targets = buildTargets(ctx, platforms, connectionIds, mediaIds);
      const scheduledAt = typeof input.scheduledAt === "string" ? input.scheduledAt : undefined;
      const candidate = postInputSchema.parse({
        title: typeof input.title === "string" ? input.title : "",
        caption: typeof input.caption === "string" ? input.caption : "",
        hashtags: Array.isArray(input.hashtags) ? input.hashtags : [],
        mediaIds,
        targets,
        scheduledAt: scheduledAt ?? null,
        status: scheduledAt ? "scheduled" : "draft",
      });
      const now = new Date().toISOString();
      const post = postsRepo.create({
        id: nanoid(),
        orgId: ctx.org.id,
        title: candidate.title,
        caption: candidate.caption,
        hashtags: candidate.hashtags,
        mediaIds: candidate.mediaIds,
        targets: candidate.targets,
        status: candidate.status ?? "draft",
        scheduledAt: candidate.scheduledAt ?? null,
        timezone: candidate.timezone,
        publishMode: candidate.publishMode,
        queueSpacingMinutes: candidate.queueSpacingMinutes,
        labels: candidate.labels,
        notes: candidate.notes,
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
      });
      log.info("agent", `Agent created post ${post.id}`, { orgId: ctx.org.id, userId: ctx.user.id, data: { postId: post.id } });
      return { ok: true, summary: `Created post ${post.id} ("${post.title || "untitled"}").`, data: post };
    }
    case "update_post": {
      const existing = postsRepo.get(String(input.id));
      if (!existing || existing.orgId !== ctx.org.id) return { ok: false, summary: `Post ${input.id} not found.` };
      const { id: _id, ...rest } = input;
      const allowed = ["title", "caption", "hashtags", "mediaIds", "scheduledAt", "notes", "labels", "publishMode", "queueSpacingMinutes"];
      const patch: Record<string, unknown> = {};
      for (const key of allowed) if (key in rest) patch[key] = rest[key];
      const updated = postsRepo.save({ ...existing, ...patch, updatedAt: new Date().toISOString() } as typeof existing);
      log.info("agent", `Agent updated post ${updated.id}`, { orgId: ctx.org.id, userId: ctx.user.id, data: { postId: updated.id } });
      return { ok: true, summary: `Updated post ${updated.id}.`, data: updated };
    }
    case "schedule_post": {
      const existing = postsRepo.get(String(input.id));
      if (!existing || existing.orgId !== ctx.org.id) return { ok: false, summary: `Post ${input.id} not found.` };
      const scheduledAt = String(input.scheduledAt);
      const updated = postsRepo.save({ ...existing, scheduledAt, status: "scheduled", updatedAt: new Date().toISOString() });
      log.info("agent", `Agent scheduled post ${updated.id} for ${scheduledAt}`, { orgId: ctx.org.id, userId: ctx.user.id, data: { postId: updated.id } });
      return { ok: true, summary: `Post ${updated.id} scheduled for ${scheduledAt}.`, data: updated };
    }
    case "publish_post": {
      const existing = postsRepo.get(String(input.id));
      if (!existing || existing.orgId !== ctx.org.id) return { ok: false, summary: `Post ${input.id} not found.` };
      const result = await publishPost(ctx.db, existing);
      log.info("agent", `Agent published post ${existing.id}`, { orgId: ctx.org.id, userId: ctx.user.id, data: { postId: existing.id, jobs: result.jobs.length } });
      return { ok: true, summary: `Published post ${existing.id}: status is now ${result.post.status}.`, data: result };
    }
    case "delete_post": {
      const existing = postsRepo.get(String(input.id));
      if (!existing || existing.orgId !== ctx.org.id) return { ok: false, summary: `Post ${input.id} not found.` };
      postsRepo.delete(existing.id);
      log.info("agent", `Agent deleted post ${existing.id}`, { orgId: ctx.org.id, userId: ctx.user.id, data: { postId: existing.id } });
      return { ok: true, summary: `Deleted post ${existing.id}.` };
    }
    case "list_media": {
      let media = mediaRepo.listByOrg(ctx.org.id);
      if (typeof input.kind === "string") media = media.filter((m) => m.kind === input.kind);
      if (typeof input.tag === "string") media = media.filter((m) => m.tags.includes(input.tag as string));
      return { ok: true, summary: `Found ${media.length} media asset(s).`, data: media.slice(0, 50) };
    }
    case "list_accounts": {
      const accounts = connectionsRepo.listByOrg(ctx.org.id);
      return { ok: true, summary: `${accounts.length} account(s) configured.`, data: accounts };
    }
    case "list_jobs": {
      const status = typeof input.status === "string" ? (input.status as never) : undefined;
      const jobs = jobsRepo.listByOrg(ctx.org.id, { status, limit: 50 });
      return { ok: true, summary: `Found ${jobs.length} job(s).`, data: jobs };
    }
    case "retry_job": {
      const job = jobsRepo.get(String(input.id));
      if (!job || job.orgId !== ctx.org.id) return { ok: false, summary: `Job ${input.id} not found.` };
      const updated = await retryJob(ctx.db, job.id);
      log.info("agent", `Agent retried job ${job.id}`, { orgId: ctx.org.id, userId: ctx.user.id, data: { jobId: job.id } });
      return { ok: true, summary: `Retried job ${job.id}: ${updated?.status}.`, data: updated };
    }
    case "analytics_summary": {
      const range = input.range === "7d" ? 7 : 30;
      const to = new Date();
      const from = new Date(to.getTime() - (range - 1) * 86_400_000);
      const summary = summarize(ctx.db, ctx.org.id, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
      return { ok: true, summary: `Analytics summary for the last ${range} days.`, data: summary };
    }
    case "generate_captions": {
      const brief = String(input.brief ?? "");
      const platforms = Array.isArray(input.platforms) ? (input.platforms as Platform[]) : [];
      if (!brief || platforms.length === 0) return { ok: false, summary: "generate_captions needs a brief and at least one platform." };
      const result = await generateCaptions(ctx.db, { brief, platforms, tone: "professional", includeHashtags: true, includeCta: true, language: "English", variants: 1 });
      return { ok: true, summary: `Generated ${result.variants.length} caption variant(s).`, data: result };
    }
    case "recent_logs": {
      const level = typeof input.level === "string" ? (input.level as never) : undefined;
      const limit = typeof input.limit === "number" ? input.limit : 20;
      const entries = log.recent({ level, limit });
      return { ok: true, summary: `Last ${entries.length} log entr${entries.length === 1 ? "y" : "ies"}.`, data: entries };
    }
    case "search_posts": {
      const q = String(input.q ?? "").toLowerCase();
      const posts = postsRepo.listByOrg(ctx.org.id, { includeUnscheduled: true }).filter(
        (p) => p.title.toLowerCase().includes(q) || p.caption.toLowerCase().includes(q)
      );
      return { ok: true, summary: `Found ${posts.length} post(s) matching "${q}".`, data: posts };
    }
    default:
      return { ok: false, summary: `Unknown tool "${name}".` };
  }
}
