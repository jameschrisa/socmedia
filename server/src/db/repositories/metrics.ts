import { nanoid } from "nanoid";
import type { MetricSnapshot, Platform } from "@socmedia/shared";
import type { Db, Row } from "../database";

function rowToSnapshot(row: Row): MetricSnapshot {
  return {
    id: row.id,
    orgId: row.orgId,
    connectionId: row.connectionId,
    platform: row.platform,
    postId: row.postId ?? null,
    date: row.date,
    followers: row.followers,
    impressions: row.impressions,
    reach: row.reach,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    saves: row.saves,
    clicks: row.clicks,
    views: row.views,
    engagementRate: row.engagementRate,
  };
}

export interface MetricFilters {
  platform?: Platform;
  from?: string;
  to?: string;
}

export class MetricsRepo {
  constructor(private db: Db) {}

  listByOrg(orgId: string, filters: MetricFilters = {}): MetricSnapshot[] {
    const rows = this.db.prepare("SELECT * FROM metric_snapshots WHERE orgId = ? ORDER BY date ASC").all(orgId) as Row[];
    let snapshots = rows.map(rowToSnapshot);
    if (filters.platform) snapshots = snapshots.filter((s) => s.platform === filters.platform);
    if (filters.from) snapshots = snapshots.filter((s) => s.date >= filters.from!);
    if (filters.to) snapshots = snapshots.filter((s) => s.date <= filters.to!);
    return snapshots;
  }

  /** Upserts by (connectionId, date) so re-syncing is idempotent. */
  upsert(snapshot: Omit<MetricSnapshot, "id"> & { id?: string }): MetricSnapshot {
    const existing = this.db
      .prepare("SELECT id FROM metric_snapshots WHERE connectionId = ? AND date = ?")
      .get(snapshot.connectionId, snapshot.date) as Row | undefined;
    const id = existing?.id ?? snapshot.id ?? nanoid();
    this.db
      .prepare(
        `INSERT INTO metric_snapshots (id, orgId, connectionId, platform, postId, date, followers, impressions, reach, likes, comments, shares, saves, clicks, views, engagementRate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connectionId, date) DO UPDATE SET
           followers=excluded.followers, impressions=excluded.impressions, reach=excluded.reach,
           likes=excluded.likes, comments=excluded.comments, shares=excluded.shares, saves=excluded.saves,
           clicks=excluded.clicks, views=excluded.views, engagementRate=excluded.engagementRate`
      )
      .run(
        id,
        snapshot.orgId,
        snapshot.connectionId,
        snapshot.platform,
        snapshot.postId ?? null,
        snapshot.date,
        snapshot.followers,
        snapshot.impressions,
        snapshot.reach,
        snapshot.likes,
        snapshot.comments,
        snapshot.shares,
        snapshot.saves,
        snapshot.clicks,
        snapshot.views,
        snapshot.engagementRate
      );
    return { ...snapshot, id } as MetricSnapshot;
  }
}
