import type { Platform, Post, PostStatus } from "@socmedia/shared";
import type { Db, Row } from "../database";

function rowToPost(row: Row): Post {
  return {
    id: row.id,
    orgId: row.orgId,
    title: row.title,
    caption: row.caption,
    hashtags: JSON.parse(row.hashtags ?? "[]"),
    mediaIds: JSON.parse(row.mediaIds ?? "[]"),
    targets: JSON.parse(row.targets ?? "[]"),
    status: row.status,
    scheduledAt: row.scheduledAt ?? null,
    timezone: row.timezone,
    publishMode: row.publishMode === "queue" ? "queue" : "all",
    queueSpacingMinutes: Number(row.queueSpacingMinutes ?? 10),
    labels: JSON.parse(row.labels ?? "[]"),
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt ?? null,
  };
}

export interface PostFilters {
  from?: string;
  to?: string;
  status?: PostStatus[];
  platform?: Platform;
  includeUnscheduled?: boolean;
}

export class PostsRepo {
  constructor(private db: Db) {}

  listByOrg(orgId: string, filters: PostFilters = {}): Post[] {
    const rows = this.db.prepare("SELECT * FROM posts WHERE orgId = ?").all(orgId) as Row[];
    let posts = rows.map(rowToPost);

    if (filters.status && filters.status.length > 0) {
      const statusSet = new Set(filters.status);
      posts = posts.filter((p) => statusSet.has(p.status));
    }
    if (filters.platform) {
      posts = posts.filter((p) => p.targets.some((t) => t.platform === filters.platform));
    }
    if (filters.from || filters.to) {
      const fromTime = filters.from ? Date.parse(filters.from) : Number.NEGATIVE_INFINITY;
      const toTime = filters.to ? Date.parse(filters.to) : Number.POSITIVE_INFINITY;
      posts = posts.filter((p) => {
        if (!p.scheduledAt) return !!filters.includeUnscheduled;
        const t = Date.parse(p.scheduledAt);
        return t >= fromTime && t <= toTime;
      });
    }

    posts.sort((a, b) => {
      const at = a.scheduledAt ? Date.parse(a.scheduledAt) : Date.parse(a.createdAt);
      const bt = b.scheduledAt ? Date.parse(b.scheduledAt) : Date.parse(b.createdAt);
      return at - bt;
    });
    return posts;
  }

  get(id: string): Post | undefined {
    const row = this.db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToPost(row) : undefined;
  }

  create(post: Post): Post {
    this.db
      .prepare(
        `INSERT INTO posts (id, orgId, title, caption, hashtags, mediaIds, targets, status, scheduledAt, timezone, publishMode, queueSpacingMinutes, labels, notes, createdAt, updatedAt, publishedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        post.id,
        post.orgId,
        post.title,
        post.caption,
        JSON.stringify(post.hashtags),
        JSON.stringify(post.mediaIds),
        JSON.stringify(post.targets),
        post.status,
        post.scheduledAt ?? null,
        post.timezone,
        post.publishMode ?? "all",
        post.queueSpacingMinutes ?? 10,
        JSON.stringify(post.labels),
        post.notes,
        post.createdAt,
        post.updatedAt,
        post.publishedAt ?? null
      );
    return this.get(post.id)!;
  }

  save(post: Post): Post {
    this.db
      .prepare(
        `UPDATE posts SET title=?, caption=?, hashtags=?, mediaIds=?, targets=?, status=?, scheduledAt=?, timezone=?, publishMode=?, queueSpacingMinutes=?, labels=?, notes=?, updatedAt=?, publishedAt=?
         WHERE id=?`
      )
      .run(
        post.title,
        post.caption,
        JSON.stringify(post.hashtags),
        JSON.stringify(post.mediaIds),
        JSON.stringify(post.targets),
        post.status,
        post.scheduledAt ?? null,
        post.timezone,
        post.publishMode ?? "all",
        post.queueSpacingMinutes ?? 10,
        JSON.stringify(post.labels),
        post.notes,
        post.updatedAt,
        post.publishedAt ?? null,
        post.id
      );
    return this.get(post.id)!;
  }

  delete(id: string): boolean {
    const res = this.db.prepare("DELETE FROM posts WHERE id = ?").run(id);
    return Number(res.changes) > 0;
  }

  /** Posts that are due to publish: status='scheduled' and scheduledAt <= now. */
  dueForPublish(now: Date): Post[] {
    const rows = this.db.prepare("SELECT * FROM posts WHERE status = 'scheduled' AND scheduledAt IS NOT NULL AND scheduledAt <= ?").all(now.toISOString()) as Row[];
    return rows.map(rowToPost);
  }
}
