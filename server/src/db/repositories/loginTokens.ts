import type { Db, Row } from "../database";

/** A single-use login token (magic link). Only its sha256 hash is stored. */
export interface LoginTokenRecord {
  id: string;
  email: string;
  tokenHash: string;
  purpose: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface CreateLoginTokenInput {
  id: string;
  email: string;
  tokenHash: string;
  purpose: string;
  expiresAt: string;
  createdAt: string;
}

function rowToRecord(row: Row): LoginTokenRecord {
  return {
    id: row.id,
    email: row.email,
    tokenHash: row.tokenHash,
    purpose: row.purpose,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt ?? null,
    createdAt: row.createdAt,
  };
}

export class LoginTokensRepo {
  constructor(private db: Db) {}

  create(input: CreateLoginTokenInput): LoginTokenRecord {
    this.db
      .prepare(
        `INSERT INTO login_tokens (id, email, tokenHash, purpose, expiresAt, usedAt, createdAt) VALUES (?, ?, ?, ?, ?, NULL, ?)`
      )
      .run(input.id, input.email, input.tokenHash, input.purpose, input.expiresAt, input.createdAt);
    return this.get(input.id)!;
  }

  get(id: string): LoginTokenRecord | undefined {
    const row = this.db.prepare("SELECT * FROM login_tokens WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  getByHash(tokenHash: string): LoginTokenRecord | undefined {
    const row = this.db.prepare("SELECT * FROM login_tokens WHERE tokenHash = ?").get(tokenHash) as Row | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  markUsed(id: string, usedAt: string): void {
    this.db.prepare("UPDATE login_tokens SET usedAt = ? WHERE id = ?").run(usedAt, id);
  }
}
