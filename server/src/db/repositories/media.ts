import type { MediaAsset } from "@socmedia/shared";
import type { Db, Row } from "../database";

function rowToMedia(row: Row): MediaAsset {
  return {
    id: row.id,
    orgId: row.orgId,
    kind: row.kind,
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    width: row.width ?? null,
    height: row.height ?? null,
    durationSeconds: row.durationSeconds ?? null,
    url: row.url,
    thumbnailUrl: row.thumbnailUrl ?? null,
    tags: JSON.parse(row.tags ?? "[]"),
    sourceAssetId: row.sourceAssetId ?? null,
    format: row.format ?? null,
    createdAt: row.createdAt,
  };
}

export class MediaRepo {
  constructor(private db: Db) {}

  listByOrg(orgId: string): MediaAsset[] {
    const rows = this.db.prepare("SELECT * FROM media WHERE orgId = ? ORDER BY createdAt DESC").all(orgId) as Row[];
    return rows.map(rowToMedia);
  }

  get(id: string): MediaAsset | undefined {
    const row = this.db.prepare("SELECT * FROM media WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToMedia(row) : undefined;
  }

  getMany(ids: string[]): MediaAsset[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT * FROM media WHERE id IN (${placeholders})`).all(...ids) as Row[];
    return rows.map(rowToMedia);
  }

  create(asset: MediaAsset): MediaAsset {
    this.db
      .prepare(
        `INSERT INTO media (id, orgId, kind, filename, mimeType, size, width, height, durationSeconds, url, thumbnailUrl, tags, sourceAssetId, format, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        asset.id,
        asset.orgId,
        asset.kind,
        asset.filename,
        asset.mimeType,
        asset.size,
        asset.width ?? null,
        asset.height ?? null,
        asset.durationSeconds ?? null,
        asset.url,
        asset.thumbnailUrl ?? null,
        JSON.stringify(asset.tags ?? []),
        asset.sourceAssetId ?? null,
        asset.format ?? null,
        asset.createdAt
      );
    return this.get(asset.id)!;
  }

  update(id: string, patch: { tags?: string[] }): MediaAsset | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const tags = patch.tags ?? existing.tags;
    this.db.prepare("UPDATE media SET tags = ? WHERE id = ?").run(JSON.stringify(tags), id);
    return this.get(id);
  }

  /** Swap the stored file (and its derived metadata) on an existing asset, keeping its id, tags and history. */
  replaceFile(id: string, patch: { filename: string; mimeType: string; size: number; width?: number | null; height?: number | null; url: string; thumbnailUrl?: string | null; format?: string | null }): MediaAsset | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    this.db
      .prepare("UPDATE media SET filename = ?, mimeType = ?, size = ?, width = ?, height = ?, url = ?, thumbnailUrl = ?, format = ? WHERE id = ?")
      .run(patch.filename, patch.mimeType, patch.size, patch.width ?? null, patch.height ?? null, patch.url, patch.thumbnailUrl ?? null, patch.format ?? existing.format ?? null, id);
    return this.get(id);
  }

  delete(id: string): boolean {
    const res = this.db.prepare("DELETE FROM media WHERE id = ?").run(id);
    return Number(res.changes) > 0;
  }
}
