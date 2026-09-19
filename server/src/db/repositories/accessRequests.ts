import type { AccessRequest, AccessRequestStatus } from "@socmedia/shared";
import type { Db, Row } from "../database";

function rowToRequest(row: Row): AccessRequest {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    organization: row.organization ?? null,
    message: row.message ?? null,
    status: row.status as AccessRequestStatus,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt ?? null,
    decidedBy: row.decidedBy ?? null,
  };
}

export interface CreateAccessRequestInput {
  id: string;
  email: string;
  name: string;
  organization?: string | null;
  message?: string | null;
  createdAt: string;
}

export class AccessRequestsRepo {
  constructor(private db: Db) {}

  /** Newest first, optionally filtered by status. */
  list(status?: AccessRequestStatus): AccessRequest[] {
    const rows = status
      ? (this.db.prepare("SELECT * FROM access_requests WHERE status = ? ORDER BY createdAt DESC").all(status) as Row[])
      : (this.db.prepare("SELECT * FROM access_requests ORDER BY createdAt DESC").all() as Row[]);
    return rows.map(rowToRequest);
  }

  get(id: string): AccessRequest | undefined {
    const row = this.db.prepare("SELECT * FROM access_requests WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToRequest(row) : undefined;
  }

  getPendingByEmail(email: string): AccessRequest | undefined {
    const row = this.db
      .prepare("SELECT * FROM access_requests WHERE email = ? COLLATE NOCASE AND status = 'pending'")
      .get(email) as Row | undefined;
    return row ? rowToRequest(row) : undefined;
  }

  create(input: CreateAccessRequestInput): AccessRequest {
    this.db
      .prepare(
        `INSERT INTO access_requests (id, email, name, organization, message, status, createdAt, decidedAt, decidedBy)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, NULL)`
      )
      .run(input.id, input.email, input.name, input.organization ?? null, input.message ?? null, input.createdAt);
    return this.get(input.id)!;
  }

  decide(id: string, status: "approved" | "declined", decidedBy: string, decidedAt: string): AccessRequest | undefined {
    this.db
      .prepare("UPDATE access_requests SET status = ?, decidedAt = ?, decidedBy = ? WHERE id = ?")
      .run(status, decidedAt, decidedBy, id);
    return this.get(id);
  }
}
