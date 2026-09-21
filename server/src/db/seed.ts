import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { PLATFORMS } from "@socmedia/shared";
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
    title: "Flu shot clinics open this week",
    caption:
      "Walk-in flu shots at all four Larkspur clinics, Monday through Saturday, no appointment needed. Most insurance plans cover it in full.\n\nBring your card and ten minutes.",
    hashtags: ["flushot", "primarycare", "communityhealth", "larkspurhealth"],
    status: "published",
    offsetDays: -16,
    platforms: ["instagram", "linkedin"],
    jobs: { instagram: "succeeded", linkedin: "succeeded" },
  },
  {
    title: "Three signs it's time to see someone about your sleep",
    caption:
      "Waking up tired every day is not normal. Dr. Amara Osei walks through the three patterns that are worth a conversation with your doctor, and what a sleep assessment actually involves.",
    hashtags: ["sleephealth", "wellness", "askadoctor"],
    status: "published",
    offsetDays: -12,
    platforms: ["youtube", "tiktok"],
    jobs: { youtube: "succeeded", tiktok: "succeeded" },
  },
  {
    title: "Meet Nurse Practitioner Teo Ramirez",
    caption:
      "Teo joined our Eastside clinic in March and already has a waiting list. Here he explains why he spends the first visit mostly listening.",
    hashtags: ["meettheteam", "nursepractitioner", "primarycare"],
    status: "published",
    offsetDays: -8,
    platforms: ["linkedin", "instagram", "youtube"],
    jobs: { linkedin: "succeeded", instagram: "succeeded", youtube: "failed" },
  },
  {
    title: "Same-day telehealth now available",
    caption:
      "Video visits for colds, rashes, prescription refills and follow-ups, usually within two hours. Book from the patient portal or the app.\n\nIn-person care is still here when you need it.",
    hashtags: ["telehealth", "patientcare", "healthcareaccess"],
    status: "partially_published",
    offsetDays: -3,
    platforms: ["linkedin", "instagram"],
    jobs: { linkedin: "succeeded", instagram: "failed" },
  },
  {
    title: "Ten-minute mobility routine for desk workers",
    caption:
      "Our physical therapy team put together a routine you can do next to your desk. No equipment, ten minutes, and your lower back will thank you by Friday.",
    hashtags: ["physicaltherapy", "mobility", "deskstretch"],
    status: "scheduled",
    offsetDays: 2,
    platforms: ["tiktok", "instagram"],
  },
  {
    title: "Free blood pressure screening, Saturday",
    caption:
      "Drop by the Northgate clinic between 9am and 1pm this Saturday for a free blood pressure check and a five-minute chat with a nurse. Bring a neighbor.",
    hashtags: ["hearthealth", "bloodpressure", "communityhealth"],
    status: "scheduled",
    offsetDays: 5,
    platforms: ["instagram", "linkedin"],
  },
  {
    title: "What your annual physical actually checks",
    caption:
      "Bloodwork, blood pressure, vaccines, screenings by age, and a real conversation about how you're doing. Here's what to expect and how to prepare.",
    hashtags: ["annualphysical", "preventivecare", "healthtips"],
    status: "needs_approval",
    offsetDays: 9,
    platforms: ["instagram", "tiktok"],
  },
  {
    title: "Pediatric weekend hours start in December",
    caption:
      "Our pediatric team will be open Saturdays from 8am to 2pm starting the first week of December. Sick visits, well checks and vaccinations.",
    hashtags: ["pediatrics", "familyhealth", "weekendcare"],
    status: "scheduled",
    offsetDays: 13,
    platforms: ["instagram", "linkedin", "youtube"],
  },
  {
    title: "How to read your lab results in the portal",
    caption: "A two-minute walkthrough of the results page, what the reference ranges mean, and when to message your care team.",
    hashtags: ["patientportal", "labresults", "healthliteracy"],
    status: "draft",
    offsetDays: null,
    platforms: ["youtube"],
  },
  {
    title: "Community health report: first half of 2026",
    caption: "Visits, wait times, vaccination rates and what we're changing for the rest of the year.",
    hashtags: ["communityhealth", "transparency", "healthcare"],
    status: "draft",
    offsetDays: null,
    platforms: ["linkedin"],
  },
  {
    title: "Flu shot clinics: walk-ins welcome all week",
    caption:
      "Reminder: all four Larkspur clinics are doing walk-in flu shots through Saturday. No appointment, most insurance covers it in full.",
    hashtags: ["flushot", "communityhealth"],
    status: "published",
    offsetDays: -14,
    platforms: ["x"],
    jobs: { x: "succeeded" },
  },
  {
    title: "Same-day telehealth, now booking",
    caption: "Cold, rash, refill or follow-up? Book a same-day video visit from the patient portal, usually seen within two hours.",
    hashtags: ["telehealth", "patientcare"],
    status: "scheduled",
    offsetDays: 4,
    platforms: ["x"],
  },
];

export const DEMO_PROFILES: Record<string, DemoProfile> = {
  larkspur: {
    key: "larkspur",
    name: "Larkspur Health",
    slug: "larkspur-health",
    brandColor: "#2E8B7A",
    timezone: "America/Los_Angeles",
    displayName: "Larkspur Health",
    handle: "@larkspurhealth",
    followers: { tiktok: 12400, youtube: 5310, linkedin: 8760, instagram: 19850, x: 7420 },
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
    case "x":
      return `https://x.com/${handle.replace(/^@/, "")}/status/${id}`;
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
  for (const platform of PLATFORMS) {
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
    x: media.square,
  };
  const formatForPlatform: Record<Platform, PostFormat> = {
    tiktok: "portrait_9_16",
    youtube: "landscape_16_9",
    linkedin: "square",
    instagram: "square",
    x: "square",
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
      publishMode: "all",
      queueSpacingMinutes: 10,
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
export async function createDemoOrg(db: Db, base: DemoProfile, overrides: Partial<Pick<DemoProfile, "name" | "slug" | "handle" | "displayName" | "brandColor" | "timezone">> = {}) {
  const profile: DemoProfile = { ...base, ...overrides, displayName: overrides.displayName ?? overrides.name ?? base.displayName };
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

/**
 * Names a real account on one of an organization's connections without pretending it is connected.
 * The sandbox adapter keeps an existing displayName/handle, so a later Connect shows the real
 * channel rather than stamping "Sandbox Account" over it.
 */
function setConnectionIdentity(db: Db, orgId: string, platform: Platform, displayName: string, handle: string): void {
  const repo = new ConnectionsRepo(db);
  const existing = repo.getByOrgAndPlatform(orgId, platform);
  if (!existing) return;
  repo.save({ ...existing, displayName, handle, updatedAt: now() });
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

/**
 * Gives every existing organization a (disconnected, sandbox) account on any platform added after
 * the org was created, so a new platform such as X shows up for old databases on the next start.
 */
export function ensurePlatformCoverage(db: Db): number {
  const orgsRepo = new OrganizationsRepo(db);
  const connectionsRepo = new ConnectionsRepo(db);
  let added = 0;
  for (const org of orgsRepo.list()) {
    const before = connectionsRepo.listByOrg(org.id).length;
    ensureConnectionsForOrg(db, org.id);
    added += connectionsRepo.listByOrg(org.id).length - before;
  }
  return added;
}

export async function seedIfEmpty(db: Db): Promise<void> {
  const orgsRepo = new OrganizationsRepo(db);
  if (orgsRepo.count() > 0) {
    ensurePlatformCoverage(db);
    return;
  }

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
  // F3i's real YouTube channel. Named here rather than left blank so a fresh database, or a
  // restore into a new environment, carries the channel instead of an anonymous placeholder.
  // Left disconnected on purpose: no OAuth has happened, and sandbox "connected" would imply it has.
  setConnectionIdentity(db, org.id, "youtube", "Executive Upskill", "@ExecutiveUpskill");

  await createDemoOrg(db, DEMO_PROFILES.larkspur!);

  const enel = await createDemoOrg(db, DEMO_PROFILES.larkspur!, {
    name: "Enel Health",
    slug: "enel-health",
    handle: "@enelhealth",
    brandColor: "#1A2430",
    timezone: "America/New_York",
  });
  seedBundledLogo(db, enel.id, "enel-mark.svg");
}
