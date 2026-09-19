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

/** A demo content profile: brand identity plus a realistic set of posts. */
export interface DemoProfile {
  key: string;
  name: string;
  slug: string;
  brandColor: string;
  timezone: string;
  displayName: string;
  handle: string;
  followers: Record<Platform, number>;
  posts: SamplePostSpec[];
}

const LARKSPUR_POSTS: SamplePostSpec[] = [
  {
    title: "Ethiopia Guji, washed: back on the shelf",
    caption:
      "Our most requested coffee is back. Guji Uraga, washed, tasting like bergamot, peach and a long honey finish.\n\nRoasted Tuesday, shipping Thursday. 250g and 1kg bags.",
    hashtags: ["specialtycoffee", "singleorigin", "ethiopiancoffee", "larkspurroasters"],
    status: "published",
    offsetDays: -16,
    platforms: ["instagram", "tiktok"],
    jobs: { instagram: "succeeded", tiktok: "succeeded" },
  },
  {
    title: "Why your pour-over tastes sour (and the 30-second fix)",
    caption:
      "Sour cup? Nine times out of ten it's under-extraction. Grind a touch finer, raise your water to 96°C, and slow the pour. Watch the full method in the video.",
    hashtags: ["pourover", "brewguide", "homebarista", "v60"],
    status: "published",
    offsetDays: -12,
    platforms: ["youtube", "tiktok"],
    jobs: { youtube: "succeeded", tiktok: "succeeded" },
  },
  {
    title: "Meet Rosa, head roaster",
    caption:
      "Rosa has cupped over 4,000 lots for us since 2021. Here she explains how she picks a roast curve for a new harvest, and why she never trusts the first batch.",
    hashtags: ["roastery", "behindthescenes", "coffeeroasting"],
    status: "published",
    offsetDays: -8,
    platforms: ["linkedin", "instagram", "youtube"],
    jobs: { linkedin: "succeeded", instagram: "succeeded", youtube: "failed" },
  },
  {
    title: "Wholesale pricing for 2027 cafés",
    caption:
      "We're opening 12 wholesale partner slots for cafés in the Pacific Northwest. Weekly roasting, free dial-in support, and no minimums for your first quarter.\n\nDetails and application in the comments.",
    hashtags: ["wholesalecoffee", "cafeowners", "pnwcoffee"],
    status: "partially_published",
    offsetDays: -3,
    platforms: ["linkedin", "instagram"],
    jobs: { linkedin: "succeeded", instagram: "failed" },
  },
  {
    title: "Cold brew concentrate: the 1:8 recipe",
    caption:
      "Twelve hours, coarse grind, 1:8 by weight. That's the whole recipe. Dilute 1:1 with water or milk and you're set for the week.",
    hashtags: ["coldbrew", "recipe", "summercoffee"],
    status: "scheduled",
    offsetDays: 2,
    platforms: ["tiktok", "instagram"],
  },
  {
    title: "Saturday cupping at the roastery",
    caption:
      "Free public cupping this Saturday at 10am. Six coffees on the table including two we haven't released yet. No experience needed, bring a friend.",
    hashtags: ["cupping", "portlandcoffee", "coffeeevents"],
    status: "scheduled",
    offsetDays: 5,
    platforms: ["instagram", "linkedin"],
  },
  {
    title: "Colombia Huila, natural: first look",
    caption:
      "Strawberry, cacao nib, and a syrupy body. We only got 4 bags of this natural from finca La Esperanza, so it's a small release.",
    hashtags: ["colombiancoffee", "naturalprocess", "smallbatch"],
    status: "needs_approval",
    offsetDays: 9,
    platforms: ["instagram", "tiktok"],
  },
  {
    title: "Holiday gift boxes open for pre-order",
    caption:
      "Three coffees, a ceramic dripper, and a hand-written tasting card. Pre-orders open today, shipping the first week of December.",
    hashtags: ["giftguide", "coffeegifts", "holidaygifts"],
    status: "scheduled",
    offsetDays: 13,
    platforms: ["instagram", "linkedin", "youtube"],
  },
  {
    title: "Grinder maintenance in 5 minutes",
    caption: "Burrs clean, retention low, coffee sweeter. A quick monthly routine for any home grinder.",
    hashtags: ["grinder", "coffeegear", "maintenance"],
    status: "draft",
    offsetDays: null,
    platforms: ["youtube"],
  },
  {
    title: "Origin trip recap: Nariño",
    caption: "Two weeks, nine farms, one very full notebook. Here's what we learned about next year's harvest.",
    hashtags: ["origintrip", "directtrade", "colombia"],
    status: "draft",
    offsetDays: null,
    platforms: ["linkedin"],
  },
];

export const DEMO_PROFILES: Record<string, DemoProfile> = {
  larkspur: {
    key: "larkspur",
    name: "Larkspur Coffee Roasters",
    slug: "larkspur-coffee",
    brandColor: "#B4532A",
    timezone: "America/Los_Angeles",
    displayName: "Larkspur Coffee Roasters",
    handle: "@larkspurroasters",
    followers: { tiktok: 23150, youtube: 4720, linkedin: 2980, instagram: 31600 },
    posts: LARKSPUR_POSTS,
  },
};

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

/** Fill an organization with a profile's demo content: connected sandbox accounts, media, posts, jobs and 30 days of metrics. */
export async function seedDemoContent(db: Db, orgId: string, profile: DemoProfile): Promise<void> {
  const connectionsRepo = new ConnectionsRepo(db);
  const postsRepo = new PostsRepo(db);
  const jobsRepo = new JobsRepo(db);
  const metricsRepo = new MetricsRepo(db);
  const org = new OrganizationsRepo(db).get(orgId);
  const brandColor = org?.brandColor ?? profile.brandColor;
  const fakeFollowers = profile.followers;

  const connectionByPlatform: Partial<Record<Platform, ReturnType<ConnectionsRepo["get"]>>> = {};
  for (const platform of ["tiktok", "youtube", "linkedin", "instagram"] as Platform[]) {
    const existing = connectionsRepo.getByOrgAndPlatform(orgId, platform);
    if (!existing) continue;
    const nowIso = now();
    const connected = connectionsRepo.save({
      ...existing,
      status: "connected",
      displayName: profile.displayName,
      handle: profile.handle,
      avatarUrl: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(profile.displayName)}`,
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

  for (const [index, spec] of profile.posts.entries()) {
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
      timezone: profile.timezone,
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

/** Create a new organization from a demo profile (unique slug) and fill it with content. */
export async function createDemoOrg(db: Db, profile: DemoProfile) {
  const orgsRepo = new OrganizationsRepo(db);
  let slug = profile.slug;
  let i = 2;
  while (orgsRepo.getBySlug(slug)) slug = `${profile.slug}-${i++}`;
  const org = orgsRepo.create({
    id: nanoid(),
    name: profile.name,
    slug,
    brandColor: profile.brandColor,
    timezone: profile.timezone,
    logoUrl: null,
    createdAt: now(),
  });
  ensureConnectionsForOrg(db, org.id);
  await seedDemoContent(db, org.id, profile);
  return org;
}

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

  const org = orgsRepo.create({
    id: nanoid(),
    name: "F3i",
    slug: "f3i",
    brandColor: "#C9A24B",
    timezone: "America/Chicago",
    logoUrl: null,
    createdAt: now(),
  });
  ensureConnectionsForOrg(db, org.id);
  seedBundledLogo(db, org.id, "f3i-mark.svg");

  await createDemoOrg(db, DEMO_PROFILES.larkspur!);
}
