import type { Organization } from "@socmedia/shared";
import type { Db, Row } from "../database";

function rowToOrg(row: Row): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    brandColor: row.brandColor,
    timezone: row.timezone,
    logoUrl: row.logoUrl ?? null,
    createdAt: row.createdAt,
  };
}

export class OrganizationsRepo {
  constructor(private db: Db) {}

  list(): Organization[] {
    const rows = this.db.prepare("SELECT * FROM organizations ORDER BY createdAt ASC").all() as Row[];
    return rows.map(rowToOrg);
  }

  get(id: string): Organization | undefined {
    const row = this.db.prepare("SELECT * FROM organizations WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToOrg(row) : undefined;
  }

  getBySlug(slug: string): Organization | undefined {
    const row = this.db.prepare("SELECT * FROM organizations WHERE slug = ?").get(slug) as Row | undefined;
    return row ? rowToOrg(row) : undefined;
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as c FROM organizations").get() as Row;
    return Number(row.c);
  }

  create(input: Organization): Organization {
    this.db
      .prepare(
        `INSERT INTO organizations (id, name, slug, brandColor, timezone, logoUrl, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(input.id, input.name, input.slug, input.brandColor, input.timezone, input.logoUrl ?? null, input.createdAt);
    return this.get(input.id)!;
  }

  update(id: string, patch: Partial<Pick<Organization, "name" | "slug" | "brandColor" | "timezone" | "logoUrl">>): Organization | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch };
    this.db
      .prepare(`UPDATE organizations SET name=?, slug=?, brandColor=?, timezone=?, logoUrl=? WHERE id=?`)
      .run(merged.name, merged.slug, merged.brandColor, merged.timezone, merged.logoUrl ?? null, id);
    return this.get(id);
  }

  delete(id: string): boolean {
    const res = this.db.prepare("DELETE FROM organizations WHERE id = ?").run(id);
    return Number(res.changes) > 0;
  }
}
