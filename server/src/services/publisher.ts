import { nanoid } from "nanoid";
import type { Post, PostStatus, PublishJob } from "@socmedia/shared";
import type { Db } from "../db/database";
import { ConnectionsRepo } from "../db/repositories/connections";
import { JobsRepo } from "../db/repositories/jobs";
import { MediaRepo } from "../db/repositories/media";
import { PostsRepo } from "../db/repositories/posts";
import { getAdapter } from "../platforms";

function recomputePostStatus(db: Db, post: Post): Post {
  const jobsRepo = new JobsRepo(db);
  const postsRepo = new PostsRepo(db);
  const jobs = jobsRepo.listByPost(post.id);

  const latestByConnection = new Map<string, PublishJob>();
  for (const job of jobs) {
    const existing = latestByConnection.get(job.connectionId);
    if (!existing || Date.parse(job.createdAt) >= Date.parse(existing.createdAt)) {
      latestByConnection.set(job.connectionId, job);
    }
  }
  const relevant = post.targets.map((t) => latestByConnection.get(t.connectionId)).filter((j): j is PublishJob => !!j);

  const succeeded = relevant.filter((j) => j.status === "succeeded").length;
  const failed = relevant.filter((j) => j.status === "failed").length;
  const pending = relevant.filter((j) => j.status === "queued" || j.status === "running").length;

  let status: PostStatus = post.status;
  if (relevant.length > 0 && pending === 0) {
    if (succeeded > 0 && failed === 0) status = "published";
    else if (succeeded > 0 && failed > 0) status = "partially_published";
    else if (failed > 0 && succeeded === 0) status = "failed";
  }

  const updated: Post = {
    ...post,
    status,
    publishedAt: succeeded > 0 ? post.publishedAt || new Date().toISOString() : post.publishedAt,
    updatedAt: new Date().toISOString(),
  };
  return postsRepo.save(updated);
}

async function runJob(db: Db, job: PublishJob): Promise<PublishJob> {
  const connectionsRepo = new ConnectionsRepo(db);
  const jobsRepo = new JobsRepo(db);
  const postsRepo = new PostsRepo(db);
  const mediaRepo = new MediaRepo(db);

  const conn = connectionsRepo.get(job.connectionId);
  const post = postsRepo.get(job.postId);
  const target = post?.targets.find((t) => t.connectionId === job.connectionId && t.platform === job.platform);

  let working: PublishJob = {
    ...job,
    status: "running",
    attempts: job.attempts + 1,
    startedAt: new Date().toISOString(),
  };
  working.log = [...working.log, { at: working.startedAt!, message: `Attempt ${working.attempts} started` }];
  working = jobsRepo.save(working);

  if (!conn || !post || !target) {
    const finishedAt = new Date().toISOString();
    working = jobsRepo.save({
      ...working,
      status: "failed",
      error: "Missing connection, post, or target for this job.",
      finishedAt,
      log: [...working.log, { at: finishedAt, message: "Missing connection, post, or target for this job." }],
    });
    return working;
  }

  try {
    const mediaIds = target.mediaIds.length ? target.mediaIds : post.mediaIds;
    const media = mediaRepo.getMany(mediaIds);
    const adapter = getAdapter(job.platform);
    const result = await adapter.publish(conn, post, target, media);
    const finishedAt = new Date().toISOString();
    working = jobsRepo.save({
      ...working,
      status: "succeeded",
      externalId: result.externalId,
      externalUrl: result.externalUrl,
      finishedAt,
      error: null,
      log: [...working.log, { at: finishedAt, message: `Published successfully (${result.externalId})` }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown publish error";
    const finishedAt = new Date().toISOString();
    working = jobsRepo.save({
      ...working,
      status: "failed",
      error: message,
      finishedAt,
      log: [...working.log, { at: finishedAt, message: `Failed: ${message}` }],
    });
  }
  return working;
}

/** Publishes a post through every one of its targets, creating and running a job per target. */
export async function publishPost(db: Db, post: Post): Promise<{ post: Post; jobs: PublishJob[] }> {
  const jobsRepo = new JobsRepo(db);
  const postsRepo = new PostsRepo(db);

  postsRepo.save({ ...post, status: "publishing", updatedAt: new Date().toISOString() });

  const jobs: PublishJob[] = [];
  for (const target of post.targets) {
    const now = new Date().toISOString();
    let job: PublishJob = {
      id: nanoid(),
      orgId: post.orgId,
      postId: post.id,
      connectionId: target.connectionId,
      platform: target.platform,
      status: "queued",
      attempts: 0,
      externalId: null,
      externalUrl: null,
      error: null,
      log: [{ at: now, message: `Queued for ${target.platform}` }],
      startedAt: null,
      finishedAt: null,
      createdAt: now,
    };
    job = jobsRepo.create(job);
    job = await runJob(db, job);
    jobs.push(job);
  }

  const finalPost = recomputePostStatus(db, postsRepo.get(post.id)!);
  return { post: finalPost, jobs };
}

/** Re-runs a single job (e.g. after a transient failure) and recomputes the parent post's status. */
export async function retryJob(db: Db, jobId: string): Promise<PublishJob | undefined> {
  const jobsRepo = new JobsRepo(db);
  const postsRepo = new PostsRepo(db);
  const existing = jobsRepo.get(jobId);
  if (!existing) return undefined;

  const updated = await runJob(db, existing);
  const post = postsRepo.get(existing.postId);
  if (post) recomputePostStatus(db, post);
  return updated;
}
