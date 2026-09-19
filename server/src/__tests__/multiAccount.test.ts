import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";
import { JobsRepo } from "../db/repositories/jobs";
import { runSchedulerTick } from "../services/scheduler";
import { runDueJobs } from "../services/publisher";
import { openDatabase, runIncrementalMigrations } from "../db/database";

describe("multiple accounts per platform", () => {
  let ctx: TestContext;
  beforeEach(() => { ctx = createTestContext(); });
  afterEach(() => cleanupTestContext(ctx));
  const h = () => ({ "X-Org-Id": ctx.orgId });

  async function addAccount(platform: string, label: string, copyFrom?: string) {
    const res = await request(ctx.app).post("/api/connections").set(h()).send({ platform, label, copyCredentialsFrom: copyFrom });
    expect(res.status).toBe(201);
    return res.body;
  }
  async function connect(id: string) {
    const res = await request(ctx.app).post(`/api/connections/${id}/connect`).set(h());
    expect(res.status).toBe(200);
    return res.body.connection;
  }

  it("adds several accounts on one platform, copies app credentials but not tokens, and protects the last one", async () => {
    const list = (await request(ctx.app).get("/api/connections").set(h())).body;
    const tiktok = list.find((c: any) => c.platform === "tiktok");
    await request(ctx.app).patch(`/api/connections/${tiktok.id}`).set(h()).send({ label: "Main", credentials: { clientId: "app-id", clientSecret: "app-secret", redirectUri: "https://x/cb" } });
    await connect(tiktok.id);

    const second = await addAccount("tiktok", "Founder", tiktok.id);
    expect(second.label).toBe("Founder");
    expect(second.credentials.clientId).toBe("app-id");
    expect(second.credentials.clientSecret).toMatch(/^••••/);
    expect(second.credentials.accessToken).toBe("");
    expect(second.status).toBe("disconnected");
    const third = await addAccount("tiktok", "");
    expect(third.label).toBe("Account 3");

    const all = (await request(ctx.app).get("/api/connections").set(h())).body.filter((c: any) => c.platform === "tiktok");
    expect(all).toHaveLength(3);

    const cross = await request(ctx.app).post("/api/connections").set(h()).send({ platform: "youtube", copyCredentialsFrom: tiktok.id });
    expect(cross.status).toBe(409);

    expect((await request(ctx.app).delete(`/api/connections/${third.id}`).set(h())).status).toBe(204);
    expect((await request(ctx.app).delete(`/api/connections/${second.id}`).set(h())).status).toBe(204);
    expect((await request(ctx.app).delete(`/api/connections/${tiktok.id}`).set(h())).status).toBe(409);
  });

  it("publishes to every account at once with isolated jobs and is idempotent per account", async () => {
    const list = (await request(ctx.app).get("/api/connections").set(h())).body;
    const a = list.find((c: any) => c.platform === "linkedin");
    await connect(a.id);
    const b = await connect((await addAccount("linkedin", "Company")).id);
    const c = await connect((await addAccount("linkedin", "EU")).id);

    const post = (await request(ctx.app).post("/api/posts").set(h()).send({
      title: "Multi", caption: "Hello from all of us", hashtags: ["team"],
      targets: [a, b, c].map((x) => ({ platform: "linkedin", connectionId: x.id, format: "square", mediaIds: [] })),
      publishMode: "all",
    })).body;
    expect(post.publishMode).toBe("all");

    const validation = (await request(ctx.app).post(`/api/posts/${post.id}/validate`).set(h())).body;
    expect(validation.issues.some((i: any) => i.level === "warning" && /identical caption/.test(i.message))).toBe(true);

    const pub = await request(ctx.app).post(`/api/posts/${post.id}/publish`).set(h());
    expect(pub.status).toBe(200);
    expect(pub.body.jobs).toHaveLength(3);
    expect(new Set(pub.body.jobs.map((j: any) => j.connectionId)).size).toBe(3);
    expect(pub.body.jobs.every((j: any) => j.status === "succeeded" && j.externalUrl)).toBe(true);
    expect(pub.body.post.status).toBe("published");

    // re-publishing must not post again to accounts that already succeeded
    const again = await request(ctx.app).post(`/api/posts/${post.id}/publish`).set(h());
    expect(again.body.jobs).toHaveLength(0);
    expect(new JobsRepo(ctx.db).listByPost(post.id)).toHaveLength(3);
  });

  it("queue mode spaces accounts out and the scheduler runs deferred jobs when due", async () => {
    const list = (await request(ctx.app).get("/api/connections").set(h())).body;
    const a = list.find((c: any) => c.platform === "instagram");
    await connect(a.id);
    const b = await connect((await addAccount("instagram", "Second")).id);
    const c = await connect((await addAccount("instagram", "Third")).id);

    const post = (await request(ctx.app).post("/api/posts").set(h()).send({
      title: "Queued", caption: "Spaced out", hashtags: [],
      targets: [a, b, c].map((x) => ({ platform: "instagram", connectionId: x.id, format: "square", mediaIds: [] })),
      publishMode: "queue", queueSpacingMinutes: 15,
    })).body;

    const pub = (await request(ctx.app).post(`/api/posts/${post.id}/publish`).set(h())).body;
    expect(pub.jobs).toHaveLength(3);
    const [first, second, third] = pub.jobs;
    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("queued");
    expect(third.status).toBe("queued");
    const gap = (Date.parse(third.runAt) - Date.parse(second.runAt)) / 60000;
    expect(Math.round(gap)).toBe(15);
    expect(pub.post.status).toBe("publishing");

    // nothing due yet
    expect(await runDueJobs(ctx.db, new Date(Date.parse(second.runAt) - 60_000))).toBe(0);
    // second becomes due; third still waits
    expect(await runSchedulerTick(ctx.db, new Date(Date.parse(second.runAt) + 1000))).toBe(1);
    let status = (await request(ctx.app).get(`/api/posts/${post.id}`).set(h())).body.status;
    expect(status).toBe("publishing");
    expect(await runSchedulerTick(ctx.db, new Date(Date.parse(third.runAt) + 1000))).toBe(1);
    status = (await request(ctx.app).get(`/api/posts/${post.id}`).set(h())).body.status;
    expect(status).toBe("published");
    const jobs = (await request(ctx.app).get(`/api/jobs?postId=${post.id}`).set(h())).body;
    expect(jobs.filter((j: any) => j.status === "succeeded")).toHaveLength(3);
  });

  it("stores and returns workspace publishing defaults", async () => {
    const before = (await request(ctx.app).get("/api/settings/publishing")).body;
    expect(before).toEqual({ defaultPublishMode: "all", queueSpacingMinutes: 10, warnOnDuplicateCaptions: true });
    const after = (await request(ctx.app).put("/api/settings/publishing").send({ defaultPublishMode: "queue", queueSpacingMinutes: 20 })).body;
    expect(after).toEqual({ defaultPublishMode: "queue", queueSpacingMinutes: 20, warnOnDuplicateCaptions: true });
    expect((await request(ctx.app).put("/api/settings/publishing").send({ queueSpacingMinutes: 0 })).status).toBe(400);
  });

  it("migrates an older database that still has the one-per-platform constraint", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO organizations (id, name, slug, brandColor, timezone, createdAt) VALUES ('o1','Org','org','#000000','UTC','t')").run();
    db.exec(`DROP TABLE connections; CREATE TABLE connections (
      id TEXT PRIMARY KEY, orgId TEXT NOT NULL, platform TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, mode TEXT NOT NULL DEFAULT 'sandbox',
      status TEXT NOT NULL DEFAULT 'disconnected', displayName TEXT NOT NULL DEFAULT '', handle TEXT NOT NULL DEFAULT '', avatarUrl TEXT,
      followers INTEGER NOT NULL DEFAULT 0, credentials TEXT NOT NULL, settings TEXT NOT NULL, lastTest TEXT, connectedAt TEXT,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, UNIQUE(orgId, platform));`);
    db.prepare("INSERT INTO connections (id, orgId, platform, credentials, settings, createdAt, updatedAt) VALUES ('c1','o1','tiktok','{}','{}','t','t')").run();
    runIncrementalMigrations(db);
    const ddl = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'connections'").get() as { sql: string }).sql;
    expect(ddl).not.toMatch(/UNIQUE\s*\(\s*orgId/);
    expect(ddl).toMatch(/label/);
    db.prepare("INSERT INTO connections (id, orgId, platform, credentials, settings, createdAt, updatedAt) VALUES ('c2','o1','tiktok','{}','{}','t','t')").run();
    expect((db.prepare("SELECT COUNT(*) as n FROM connections WHERE orgId='o1' AND platform='tiktok'").get() as { n: number }).n).toBe(2);
  });
});
