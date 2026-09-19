import type { JobStatus, PublishJob } from "@socmedia/shared";
import type { Db, Row } from "../database";

function rowToJob(row: Row): PublishJob {
  return {
    id: row.id,
    orgId: row.orgId,
    postId: row.postId,
    connectionId: row.connectionId,
    platform: row.platform,
    status: row.status,
    attempts: row.attempts,
    externalId: row.externalId ?? null,
    externalUrl: row.externalUrl ?? null,
    error: row.error ?? null,
    log: JSON.parse(row.log ?? "[]"),
    runAt: row.runAt ?? null,
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    createdAt: row.createdAt,
  };
}

export interface JobFilters {
  postId?: string;
  status?: JobStatus;
  limit?: number;
}

export class JobsRepo {
  constructor(private db: Db) {}

  listByOrg(orgId: string, filters: JobFilters = {}): PublishJob[] {
    const rows = this.db.prepare("SELECT * FROM publish_jobs WHERE orgId = ? ORDER BY createdAt DESC").all(orgId) as Row[];
    let jobs = rows.map(rowToJob);
    if (filters.postId) jobs = jobs.filter((j) => j.postId === filters.postId);
    if (filters.status) jobs = jobs.filter((j) => j.status === filters.status);
    if (filters.limit) jobs = jobs.slice(0, filters.limit);
    return jobs;
  }

  listByPost(postId: string): PublishJob[] {
    const rows = this.db.prepare("SELECT * FROM publish_jobs WHERE postId = ? ORDER BY createdAt DESC").all(postId) as Row[];
    return rows.map(rowToJob);
  }

  /** Deferred jobs whose runAt has passed (queue mode). */
  dueJobs(now: Date): PublishJob[] {
    const rows = this.db.prepare("SELECT * FROM publish_jobs WHERE status = 'queued' AND runAt IS NOT NULL AND runAt <= ? ORDER BY runAt ASC").all(now.toISOString()) as Row[];
    return rows.map(rowToJob);
  }

  get(id: string): PublishJob | undefined {
    const row = this.db.prepare("SELECT * FROM publish_jobs WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToJob(row) : undefined;
  }

  create(job: PublishJob): PublishJob {
    this.db
      .prepare(
        `INSERT INTO publish_jobs (id, orgId, postId, connectionId, platform, status, attempts, externalId, externalUrl, error, log, runAt, startedAt, finishedAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        job.id,
        job.orgId,
        job.postId,
        job.connectionId,
        job.platform,
        job.status,
        job.attempts,
        job.externalId ?? null,
        job.externalUrl ?? null,
        job.error ?? null,
        JSON.stringify(job.log),
        job.runAt ?? null,
        job.startedAt ?? null,
        job.finishedAt ?? null,
        job.createdAt
      );
    return this.get(job.id)!;
  }

  save(job: PublishJob): PublishJob {
    this.db
      .prepare(
        `UPDATE publish_jobs SET status=?, attempts=?, externalId=?, externalUrl=?, error=?, log=?, runAt=?, startedAt=?, finishedAt=? WHERE id=?`
      )
      .run(
        job.status,
        job.attempts,
        job.externalId ?? null,
        job.externalUrl ?? null,
        job.error ?? null,
        JSON.stringify(job.log),
        job.runAt ?? null,
        job.startedAt ?? null,
        job.finishedAt ?? null,
        job.id
      );
    return this.get(job.id)!;
  }
}
