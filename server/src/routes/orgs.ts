import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { config } from "../config";
import { nanoid } from "nanoid";
import { organizationInputSchema } from "@socmedia/shared";
import type { Db } from "../db/database";
import { allPlatforms, buildDefaultConnection } from "../db/defaults";
import { ConnectionsRepo } from "../db/repositories/connections";
import { OrganizationsRepo } from "../db/repositories/organizations";
import { requireRole } from "../middleware/auth";
import { BadRequestError, ConflictError, NotFoundError } from "../middleware/errors";
import { asyncHandler } from "../utils/asyncHandler";
import { uploadsDirFor } from "../services/media";
import { z } from "zod";
import { DEMO_PROFILES, createDemoOrg, seedDemoContent } from "../db/seed";

const LOGO_TYPES: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (LOGO_TYPES[file.mimetype]) cb(null, true);
    else cb(new Error("Logos must be SVG, PNG, JPEG or WebP"));
  },
});

export function logosDir(): string {
  return path.join(config.dataDir, "uploads", "logos");
}

/** Persist a logo buffer for an org and return its public URL; removes any previous logo file. */
export function saveOrgLogo(orgId: string, buffer: Buffer, mimeType: string, previousUrl?: string | null): string {
  const ext = LOGO_TYPES[mimeType];
  if (!ext) throw new BadRequestError("Logos must be SVG, PNG, JPEG or WebP");
  fs.mkdirSync(logosDir(), { recursive: true });
  removeLogoFile(previousUrl);
  const filename = `${orgId}-${nanoid(6)}.${ext}`;
  fs.writeFileSync(path.join(logosDir(), filename), buffer);
  return `/uploads/logos/${filename}`;
}

export function removeLogoFile(url?: string | null): void {
  if (!url || !url.startsWith("/uploads/logos/")) return;
  try {
    fs.rmSync(path.join(logosDir(), path.basename(url)), { force: true });
  } catch {
    // best effort
  }
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "org"
  );
}

function uniqueSlug(repo: OrganizationsRepo, base: string): string {
  let slug = base;
  let i = 2;
  while (repo.getBySlug(slug)) {
    slug = `${base}-${i}`;
    i += 1;
  }
  return slug;
}

/** Ensures every platform has exactly one (disconnected sandbox by default) connection for the org. */
export function ensureConnectionsForOrg(db: Db, orgId: string) {
  const connectionsRepo = new ConnectionsRepo(db);
  const now = new Date().toISOString();
  for (const platform of allPlatforms()) {
    if (!connectionsRepo.getByOrgAndPlatform(orgId, platform)) {
      connectionsRepo.create(buildDefaultConnection(orgId, platform, now));
    }
  }
}

export function orgsRouter(db: Db): Router {
  const router = Router();
  const repo = new OrganizationsRepo(db);

  // Reading the org list/detail is available to any signed-in user; every mutation is admin+.
  router.use((req, res, next) => {
    if (req.method === "GET") {
      next();
      return;
    }
    requireRole("admin")(req, res, next);
  });

  router.get(
    "/orgs",
    asyncHandler(async (_req, res) => {
      res.json(repo.list());
    })
  );

  router.post(
    "/orgs",
    asyncHandler(async (req, res) => {
      const input = organizationInputSchema.parse(req.body);
      const slug = input.slug ? uniqueSlug(repo, input.slug) : uniqueSlug(repo, slugify(input.name));
      const now = new Date().toISOString();
      const org = repo.create({
        id: nanoid(),
        name: input.name,
        slug,
        brandColor: input.brandColor,
        timezone: input.timezone,
        logoUrl: input.logoUrl ?? null,
        createdAt: now,
      });
      ensureConnectionsForOrg(db, org.id);
      res.status(201).json(org);
    })
  );

  const demoBody = z.object({
    profile: z.string().min(1),
    name: z.string().min(1).max(80).optional(),
    slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/).optional(),
    handle: z.string().min(1).max(60).optional(),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    timezone: z.string().min(1).optional(),
  });
  const resolveProfile = (key: string) => {
    const profile = DEMO_PROFILES[key];
    if (!profile) throw new BadRequestError(`Unknown demo profile "${key}". Available: ${Object.keys(DEMO_PROFILES).join(", ")}`);
    return profile;
  };

  /** Available demo content profiles. */
  router.get("/orgs/demo/profiles", (_req, res) => {
    res.json(Object.values(DEMO_PROFILES).map((p) => ({ key: p.key, name: p.name, brandColor: p.brandColor, posts: p.posts.length })));
  });

  /** Create a new organization filled with a demo profile's content. */
  router.post(
    "/orgs/demo",
    asyncHandler(async (req, res) => {
      const { profile, ...overrides } = demoBody.parse(req.body);
      const org = await createDemoOrg(db, resolveProfile(profile), overrides);
      res.status(201).json(org);
    })
  );

  /** Fill an existing organization with a demo profile's content (adds to whatever is there). */
  router.post(
    "/orgs/:id/demo",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing) throw new NotFoundError(`Organization ${req.params.id} not found`);
      const { profile } = demoBody.parse(req.body);
      ensureConnectionsForOrg(db, existing.id);
      await seedDemoContent(db, existing.id, resolveProfile(profile));
      res.json(repo.get(existing.id));
    })
  );

  router.get(
    "/orgs/:id",
    asyncHandler(async (req, res) => {
      const org = repo.get(req.params.id);
      if (!org) throw new NotFoundError(`Organization ${req.params.id} not found`);
      res.json(org);
    })
  );

  router.patch(
    "/orgs/:id",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing) throw new NotFoundError(`Organization ${req.params.id} not found`);
      const input = organizationInputSchema.partial().parse(req.body);
      if (input.slug && input.slug !== existing.slug) {
        const clash = repo.getBySlug(input.slug);
        if (clash && clash.id !== existing.id) throw new ConflictError(`Slug "${input.slug}" is already in use`);
      }
      const updated = repo.update(req.params.id, input);
      res.json(updated);
    })
  );

  router.post(
    "/orgs/:id/logo",
    logoUpload.single("file"),
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing) throw new NotFoundError(`Organization ${req.params.id} not found`);
      if (!req.file) throw new BadRequestError("Missing file field");
      const logoUrl = saveOrgLogo(existing.id, req.file.buffer, req.file.mimetype, existing.logoUrl);
      res.json(repo.update(existing.id, { logoUrl }));
    })
  );

  router.delete(
    "/orgs/:id/logo",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing) throw new NotFoundError(`Organization ${req.params.id} not found`);
      removeLogoFile(existing.logoUrl);
      res.json(repo.update(existing.id, { logoUrl: null }));
    })
  );

  router.delete(
    "/orgs/:id",
    asyncHandler(async (req, res) => {
      const existing = repo.get(req.params.id);
      if (!existing) throw new NotFoundError(`Organization ${req.params.id} not found`);
      if (repo.count() <= 1) throw new ConflictError("Cannot delete the last remaining organization");
      repo.delete(req.params.id);
      removeLogoFile(existing.logoUrl);
      try {
        fs.rmSync(uploadsDirFor(existing.id), { recursive: true, force: true });
      } catch {
        // best effort cleanup
      }
      res.status(204).end();
    })
  );

  return router;
}
