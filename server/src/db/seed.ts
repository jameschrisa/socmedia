import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import sharp from "sharp";
import type { MediaAsset, Platform, Post, PostFormat, PostStatus, PublishJob } from "@socmedia/shared";
import type { Db } from "./database";
import { ConnectionsRepo } from "../db/repositories/connections";
import { JobsRepo } from "../db/repositories/jobs";
import { MediaRepo } from "../db/repositories/media";
import { MetricsRepo } from "../db/repositories/metrics";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { PostsRepo } from "../db/repositories/posts";
import { getAdapter } from "../platforms";
import { ensureConnectionsForOrg, saveOrgLogo } from "../routes/orgs";
import { saveUploadBuffer } from "../services/media";

function shade(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const clamp = (v: number) => Math.min(255, Math.max(0, v));
  const r = clamp((num >> 16) + Math.round(255 * percent));
  const g = clamp(((num >> 8) & 0x00ff) + Math.round(255 * percent));
  const b = clamp((num & 0x0000ff) + Math.round(255 * percent));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

async function gradientPng(width: number, height: number, colorA: string, colorB: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${colorA}" />
        <stop offset="100%" stop-color="${colorB}" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)" />
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const now = () => new Date().toISOString();
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
/** Same day offset but pinned to a realistic local wall-clock hour so the calendar shows a spread of times. */
const daysFromNowAt = (n: number, hour: number, minute = 0) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const SEED_HOURS = [9, 12, 17, 10, 14, 18, 11, 16];

async function createSampleMedia(db: Db, orgId: string, brandColor: string): Promise<Record<PostFormat, MediaAsset>> {
  const mediaRepo = new MediaRepo(db);
  const specs: { format: PostFormat; width: number; height: number; label: string }[] = [
    { format: "square", width: 1080, height: 1080, label: "square" },
    { format: "portrait_9_16", width: 1080, height: 1920, label: "vertical" },
    { format: "landscape_16_9", width: 1920, height: 1080, label: "landscape" },
    { format: "landscape_1_91", width: 1200, height: 628, label: "link" },
  ];
  const result: Partial<Record<PostFormat, MediaAsset>> = {};
  let i = 0;
  for (const spec of specs) {
    const colorA = shade(brandColor, i % 2 === 0 ? 0.1 : -0.1);
    const colorB = shade(brandColor, i % 2 === 0 ? -0.25 : 0.25);
    const buffer = await gradientPng(spec.width, spec.height, colorA, colorB);
    const saved = await saveUploadBuffer(orgId, buffer, "image/png", `brand-${spec.label}.png`);
    const assetNow = now();
    const asset = mediaRepo.create({
      id: nanoid(),
      orgId,
      kind: "image",
      filename: saved.filename,
      mimeType: saved.mimeType,
      size: saved.size,
      width: saved.width ?? spec.width,
      height: saved.height ?? spec.height,
      durationSeconds: null,
      url: saved.url,
      thumbnailUrl: saved.thumbnailUrl ?? null,
      tags: ["brand", spec.label],
      sourceAssetId: null,
      format: spec.format,
      createdAt: assetNow,
    });
    result[spec.format] = asset;
    i += 1;
  }
  return result as Record<PostFormat, MediaAsset>;
}

interface SamplePostSpec {
  title: string;
  caption: string;
  hashtags: string[];
  status: PostStatus;
  offsetDays: number | null; // null = no scheduledAt (draft)
  platforms: Platform[];
  jobs?: Partial<Record<Platform, "succeeded" | "failed">>;
}

const SAMPLE_POSTS: SamplePostSpec[] = [
  {
    title: "Your 2026 tax season checklist",
    caption:
      "Tax season doesn't have to be stressful. Here's the exact checklist our advisors use to make sure clients never miss a deduction.\n\nSave this and share it with someone who needs it.",
    hashtags: ["taxseason", "taxplanning", "financialplanning", "cpa"],
    status: "published",
    offsetDays: -14,
    platforms: ["linkedin", "instagram"],
    jobs: { linkedin: "succeeded", instagram: "succeeded" },
  },
  {
    title: "5 last-minute tax deductions people forget",
    caption:
      "Still filing? These 5 deductions get missed every single year — and they could put real money back in your pocket.",
    hashtags: ["taxtips", "moneytips", "fintok", "taxseason"],
    status: "published",
    offsetDays: -7,
    platforms: ["tiktok"],
    jobs: { tiktok: "succeeded" },
  },
  {
    title: "RMD deadline reminder",
    caption:
      "If you turned 73 this year, your Required Minimum Distribution deadline is closer than you think. Here's what happens if you miss it — and how to avoid the penalty.",
    hashtags: ["retirementplanning", "rmd", "wealthmanagement"],
    status: "partially_published",
    offsetDays: -3,
    platforms: ["tiktok", "youtube"],
    jobs: { tiktok: "succeeded", youtube: "failed" },
  },
  {
    title: "Roth conversion mistakes to avoid",
    caption:
      "A Roth conversion can be a powerful move — or an expensive mistake. In this video we walk through the 3 most common errors we see and how our clients avoid them.",
    hashtags: ["rothconversion", "retirementplanning", "taxstrategy"],
    status: "scheduled",
    offsetDays: 3,
    platforms: ["youtube"],
  },
  {
    title: "Estate planning myths, debunked",
    caption:
      "\"I don't need an estate plan, I don't have that much.\" We hear this constantly — and it's one of the costliest myths in financial planning. Let's set the record straight.",
    hashtags: ["estateplanning", "financialplanning", "wealthmanagement"],
    status: "scheduled",
    offsetDays: 7,
    platforms: ["linkedin"],
  },
  {
    title: "Quarterly estimated tax tips for business owners",
    caption:
      "Running a business means quarterly estimated taxes are non-negotiable. Here's how to calculate yours without the guesswork (and avoid an underpayment penalty).",
    hashtags: ["smallbusiness", "taxplanning", "selfemployed"],
    status: "needs_approval",
    offsetDays: 10,
    platforms: ["instagram", "tiktok"],
  },
  {
    title: "Year-end charitable giving strategies",
    caption:
      "Giving season is also tax-planning season. Donor-advised funds, appreciated stock gifts, and QCDs can all stretch your generosity further — here's how.",
    hashtags: ["charitablegiving", "taxstrategy", "financialplanning"],
    status: "scheduled",
    offsetDays: 14,
    platforms: ["instagram"],
  },
  {
    title: "Meet the team: our CFP spotlight",
    caption:
      "This week we're spotlighting one of our Certified Financial Planners and the client story that reminded her why she does this work.",
    hashtags: ["meettheteam", "cfp", "financialadvisor"],
    status: "draft",
    offsetDays: null,
    platforms: ["linkedin"],
  },
];

function fakeExternalUrl(platform: Platform, handle: string, id: string): string {
  switch (platform) {
    case "tiktok":
      return `https://www.tiktok.com/${handle.startsWith("@") ? handle : `@${handle}`}/video/${id}`;
    case "youtube":
      return `https://youtu.be/${id}`;
    case "linkedin":
      return `https://www.linkedin.com/feed/update/urn:li:share:${id}`;
    case "instagram":
      return `https://www.instagram.com/p/${id}/`;
  }
}

async function seedFirstOrg(db: Db, orgId: string, brandColor: string) {
  const connectionsRepo = new ConnectionsRepo(db);
  const postsRepo = new PostsRepo(db);
  const jobsRepo = new JobsRepo(db);
  const metricsRepo = new MetricsRepo(db);

  const fakeFollowers: Record<Platform, number> = { tiktok: 18400, youtube: 6200, linkedin: 9800, instagram: 14200 };

  const connectionByPlatform: Partial<Record<Platform, ReturnType<ConnectionsRepo["get"]>>> = {};
  for (const platform of ["tiktok", "youtube", "linkedin", "instagram"] as Platform[]) {
    const existing = connectionsRepo.getByOrgAndPlatform(orgId, platform);
    if (!existing) continue;
    const nowIso = now();
    const connected = connectionsRepo.save({
      ...existing,
      status: "connected",
      displayName: "Holistiplan",
      handle: "@holistiplan",
      avatarUrl: `https://api.dicebear.com/9.x/initials/svg?seed=Holistiplan`,
      followers: fakeFollowers[platform],
      credentials: {
        ...existing.credentials,
        clientId: `demo_client_${platform}`,
        clientSecret: `demo_secret_${platform}_${nanoid(6)}`,
        redirectUri: "http://localhost:4000/api/connections/oauth/callback",
        accessToken: `sb_access_${nanoid(10)}`,
        refreshToken: `sb_refresh_${nanoid(10)}`,
        tokenExpiresAt: daysFromNow(1),
      },
      connectedAt: nowIso,
      updatedAt: nowIso,
    });
    connectionByPlatform[platform] = connected;
  }

  const media = await createSampleMedia(db, orgId, brandColor);
  const mediaForPlatform: Record<Platform, MediaAsset> = {
    tiktok: media.portrait_9_16,
    youtube: media.landscape_16_9,
    linkedin: media.square,
    instagram: media.square,
  };
  const formatForPlatform: Record<Platform, PostFormat> = {
    tiktok: "portrait_9_16",
    youtube: "landscape_16_9",
    linkedin: "square",
    instagram: "square",
  };

  for (const [index, spec] of SAMPLE_POSTS.entries()) {
    const targets = spec.platforms
      .map((platform) => connectionByPlatform[platform])
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((conn) => ({
        platform: conn!.platform,
        connectionId: conn!.id,
        format: formatForPlatform[conn!.platform],
        mediaIds: [mediaForPlatform[conn!.platform].id],
        caption: null,
        title: conn!.platform === "youtube" ? spec.title : null,
        hashtags: null,
      }));

    const scheduledAt = spec.offsetDays === null ? null : daysFromNowAt(spec.offsetDays, SEED_HOURS[index % SEED_HOURS.length]!, index % 2 === 0 ? 0 : 30);
    const createdAt = spec.offsetDays !== null && spec.offsetDays < 0 ? scheduledAt! : now();
    const post: Post = {
      id: nanoid(),
      orgId,
      title: spec.title,
      caption: spec.caption,
      hashtags: spec.hashtags,
      mediaIds: targets[0]?.mediaIds ?? [],
      targets,
      status: spec.status,
      scheduledAt,
      timezone: "America/Chicago",
      labels: [],
      notes: "",
      createdAt,
      updatedAt: createdAt,
      publishedAt: spec.status === "published" || spec.status === "partially_published" ? scheduledAt : null,
    };
    postsRepo.create(post);

    if (spec.jobs) {
      for (const [platform, outcome] of Object.entries(spec.jobs) as [Platform, "succeeded" | "failed"][]) {
        const conn = connectionByPlatform[platform];
        if (!conn) continue;
        const jobNow = scheduledAt ?? now();
        const id = `sb_${nanoid(12)}`;
        const job: PublishJob = {
          id: nanoid(),
          orgId,
          postId: post.id,
          connectionId: conn.id,
          platform,
          status: outcome,
          attempts: 1,
          externalId: outcome === "succeeded" ? id : null,
          externalUrl: outcome === "succeeded" ? fakeExternalUrl(platform, conn.handle, id) : null,
          error: outcome === "failed" ? `${platform} API rate limit exceeded (simulated)` : null,
          log: [
            { at: jobNow, message: `Queued for ${platform}` },
            { at: jobNow, message: outcome === "succeeded" ? `Published successfully (${id})` : "Failed: rate limit exceeded (simulated)" },
          ],
          startedAt: jobNow,
          finishedAt: jobNow,
          createdAt: jobNow,
        };
        jobsRepo.create(job);
      }
    }
  }

  for (const platform of Object.keys(connectionByPlatform) as Platform[]) {
    const conn = connectionByPlatform[platform];
    if (!conn) continue;
    const adapter = getAdapter(platform);
    const snapshots = await adapter.fetchMetrics(conn, 30);
    for (const s of snapshots) {
      if (!s.date) continue;
      metricsRepo.upsert({
        orgId,
        connectionId: conn.id,
        platform,
        postId: null,
        date: s.date,
        followers: s.followers ?? 0,
        impressions: s.impressions ?? 0,
        reach: s.reach ?? 0,
        likes: s.likes ?? 0,
        comments: s.comments ?? 0,
        shares: s.shares ?? 0,
        saves: s.saves ?? 0,
        clicks: s.clicks ?? 0,
        views: s.views ?? 0,
        engagementRate: s.engagementRate ?? 0,
      });
    }
  }
}

/** Idempotently seeds two demo organizations; skipped entirely when any organization already exists. */
/** Copy a logo bundled with the server (server/assets) into the uploads folder for a seeded org. */
function seedBundledLogo(db: Db, orgId: string, assetName: string): void {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [path.resolve(here, "../../assets", assetName), path.resolve(here, "../../../assets", assetName), path.resolve(process.cwd(), "server/assets", assetName)];
    const file = candidates.find((c) => fs.existsSync(c));
    if (!file) return;
    const url = saveOrgLogo(orgId, fs.readFileSync(file), "image/svg+xml", null);
    new OrganizationsRepo(db).update(orgId, { logoUrl: url });
  } catch {
    // logo is optional; never fail seeding because of it
  }
}

export async function seedIfEmpty(db: Db): Promise<void> {
  const orgsRepo = new OrganizationsRepo(db);
  if (orgsRepo.count() > 0) return;

  const org1 = orgsRepo.create({
    id: nanoid(),
    name: "Holistiplan",
    slug: "holistiplan",
    brandColor: "#6C5CE7",
    timezone: "America/Chicago",
    logoUrl: null,
    createdAt: now(),
  });
  ensureConnectionsForOrg(db, org1.id);

  const org2 = orgsRepo.create({
    id: nanoid(),
    name: "F3i",
    slug: "f3i",
    brandColor: "#C9A24B",
    timezone: "America/Chicago",
    logoUrl: null,
    createdAt: now(),
  });
  ensureConnectionsForOrg(db, org2.id);
  seedBundledLogo(db, org2.id, "f3i-mark.svg");

  await seedFirstOrg(db, org1.id, "#6C5CE7");
}
