import type { Db } from "../db/database";
import { PostsRepo } from "../db/repositories/posts";
import { publishPost } from "./publisher";

/** Publishes every scheduled post whose scheduledAt has passed. Returns the number published. */
export async function runSchedulerTick(db: Db, now: Date = new Date()): Promise<number> {
  const postsRepo = new PostsRepo(db);
  const due = postsRepo.dueForPublish(now);

  let count = 0;
  for (const post of due) {
    // Mark as publishing immediately so an overlapping tick won't pick the same post up twice.
    const marked = postsRepo.save({ ...post, status: "publishing", updatedAt: new Date().toISOString() });
    await publishPost(db, marked);
    count += 1;
  }
  return count;
}

/** Starts the background scheduler loop; returns a function that stops it. */
export function startScheduler(db: Db, intervalMs: number): () => void {
  const timer = setInterval(() => {
    runSchedulerTick(db).catch((err) => {
      console.error(JSON.stringify({ level: "error", message: "scheduler tick failed", error: err instanceof Error ? err.message : String(err) }));
    });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}
