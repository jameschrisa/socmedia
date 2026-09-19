import type { Db, Row } from "../database";

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

function rowToSession(row: Row): SessionRecord {
  return { id: row.id, userId: row.userId, expiresAt: row.expiresAt, createdAt: row.createdAt };
}

export class SessionsRepo {
  constructor(private db: Db) {}

  create(session: SessionRecord): SessionRecord {
    this.db
      .prepare(`INSERT INTO sessions (id, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)`)
      .run(session.id, session.userId, session.expiresAt, session.createdAt);
    return session;
  }

  get(id: string): SessionRecord | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToSession(row) : undefined;
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  deleteByUser(userId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE userId = ?").run(userId);
  }

  /** Lazy cleanup: removes every session past its expiry. Safe to call often. */
  deleteExpired(): void {
    this.db.prepare("DELETE FROM sessions WHERE expiresAt <= ?").run(new Date().toISOString());
  }
}
