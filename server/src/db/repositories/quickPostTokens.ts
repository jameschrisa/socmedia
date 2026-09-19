import type { PublishMode, QuickPostToken } from "@socmedia/shared";
import type { Db, Row } from "../database";

/** Internal row shape including the hash; the hash itself never leaves this repo. */
export interface QuickPostTokenRecord extends QuickPostToken {
  tokenHash: string;
}

function rowToRecord(row: Row): QuickPostTokenRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    label: row.label,
    tokenHash: row.tokenHash,
    tokenPreview: row.tokenPreview,
    connectionIds: JSON.parse(row.connectionIds ?? "[]"),
    publishMode: row.publishMode === "queue" ? "queue" : "all",
    active: !!row.active,
    usesCount: row.usesCount,
    lastUsedAt: row.lastUsedAt ?? null,
    createdAt: row.createdAt,
  };
}

export interface CreateQuickPostTokenInput {
  id: string;
  orgId: string;
  userId: string;
  label: string;
  tokenHash: string;
  tokenPreview: string;
  connectionIds: string[];
  publishMode: PublishMode;
  createdAt: string;
}

export interface UpdateQuickPostTokenPatch {
  label?: string;
  connectionIds?: string[];
  publishMode?: PublishMode;
  active?: boolean;
}

export class QuickPostTokensRepo {
  constructor(private db: Db) {}

  listByOrg(orgId: string): QuickPostTokenRecord[] {
    const rows = this.db.prepare("SELECT * FROM quick_post_tokens WHERE orgId = ? ORDER BY createdAt DESC").all(orgId) as Row[];
    return rows.map(rowToRecord);
  }

  get(id: string): QuickPostTokenRecord | undefined {
    const row = this.db.prepare("SELECT * FROM quick_post_tokens WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  getByHash(tokenHash: string): QuickPostTokenRecord | undefined {
    const row = this.db.prepare("SELECT * FROM quick_post_tokens WHERE tokenHash = ?").get(tokenHash) as Row | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  create(input: CreateQuickPostTokenInput): QuickPostTokenRecord {
    this.db
      .prepare(
        `INSERT INTO quick_post_tokens (id, orgId, userId, label, tokenHash, tokenPreview, connectionIds, publishMode, active, usesCount, lastUsedAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?)`
      )
      .run(
        input.id,
        input.orgId,
        input.userId,
        input.label,
        input.tokenHash,
        input.tokenPreview,
        JSON.stringify(input.connectionIds),
        input.publishMode,
        input.createdAt
      );
    return this.get(input.id)!;
  }

  update(id: string, patch: UpdateQuickPostTokenPatch): QuickPostTokenRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const next = {
      label: patch.label ?? existing.label,
      connectionIds: patch.connectionIds ?? existing.connectionIds,
      publishMode: patch.publishMode ?? existing.publishMode,
      active: patch.active ?? existing.active,
    };
    this.db
      .prepare("UPDATE quick_post_tokens SET label = ?, connectionIds = ?, publishMode = ?, active = ? WHERE id = ?")
      .run(next.label, JSON.stringify(next.connectionIds), next.publishMode, next.active ? 1 : 0, id);
    return this.get(id);
  }

  /** Bumps usesCount and lastUsedAt after a successful/attempted submission. */
  recordUse(id: string, at: string): void {
    this.db.prepare("UPDATE quick_post_tokens SET usesCount = usesCount + 1, lastUsedAt = ? WHERE id = ?").run(at, id);
  }

  delete(id: string): boolean {
    const res = this.db.prepare("DELETE FROM quick_post_tokens WHERE id = ?").run(id);
    return Number(res.changes) > 0;
  }
}
