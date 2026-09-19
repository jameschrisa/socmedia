import type { User, UserRole } from "@socmedia/shared";
import type { Db, Row } from "../database";

/** Internal shape including the password hash; never sent to clients. */
export interface UserRecord extends User {
  passwordHash: string;
}

function serializeOrgIds(orgIds: string[] | "*"): string {
  return orgIds === "*" ? "*" : JSON.stringify(orgIds);
}

function deserializeOrgIds(raw: string): string[] | "*" {
  if (raw === "*") return "*";
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rowToUser(row: Row): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as UserRole,
    orgIds: deserializeOrgIds(row.orgIds ?? "[]"),
    active: !!row.active,
    mustChangePassword: !!row.mustChangePassword,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt ?? null,
  };
}

function rowToUserRecord(row: Row): UserRecord {
  return { ...rowToUser(row), passwordHash: row.passwordHash };
}

export interface CreateUserInput {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  orgIds: string[] | "*";
  passwordHash: string;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
}

export interface UpdateUserPatch {
  name?: string;
  role?: UserRole;
  orgIds?: string[] | "*";
  active?: boolean;
  passwordHash?: string;
  mustChangePassword?: boolean;
  lastLoginAt?: string | null;
}

export class UsersRepo {
  constructor(private db: Db) {}

  list(): User[] {
    const rows = this.db.prepare("SELECT * FROM users ORDER BY createdAt ASC").all() as Row[];
    return rows.map(rowToUser);
  }

  get(id: string): User | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToUser(row) : undefined;
  }

  getRecord(id: string): UserRecord | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToUserRecord(row) : undefined;
  }

  /** Case-insensitive email lookup (matches the UNIQUE ... COLLATE NOCASE constraint). Includes the password hash. */
  getByEmail(email: string): UserRecord | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email) as Row | undefined;
    return row ? rowToUserRecord(row) : undefined;
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as c FROM users").get() as Row;
    return Number(row.c);
  }

  /** Number of active owners, optionally excluding one user id (used to check "last owner" rules). */
  countActiveOwners(excludingId?: string): number {
    const rows = this.db.prepare("SELECT id FROM users WHERE role = 'owner' AND active = 1").all() as Row[];
    return rows.filter((r) => r.id !== excludingId).length;
  }

  create(input: CreateUserInput): User {
    this.db
      .prepare(
        `INSERT INTO users (id, email, name, role, orgIds, passwordHash, active, mustChangePassword, createdAt, lastLoginAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.email,
        input.name,
        input.role,
        serializeOrgIds(input.orgIds),
        input.passwordHash,
        input.active ? 1 : 0,
        input.mustChangePassword ? 1 : 0,
        input.createdAt,
        input.lastLoginAt ?? null
      );
    return this.get(input.id)!;
  }

  update(id: string, patch: UpdateUserPatch): User | undefined {
    const existing = this.getRecord(id);
    if (!existing) return undefined;
    const merged: UserRecord = { ...existing, ...patch };
    this.db
      .prepare(
        `UPDATE users SET name=?, role=?, orgIds=?, passwordHash=?, active=?, mustChangePassword=?, lastLoginAt=? WHERE id=?`
      )
      .run(
        merged.name,
        merged.role,
        serializeOrgIds(merged.orgIds),
        merged.passwordHash,
        merged.active ? 1 : 0,
        merged.mustChangePassword ? 1 : 0,
        merged.lastLoginAt ?? null,
        id
      );
    return this.get(id);
  }

  touchLogin(id: string, at: string): void {
    this.db.prepare("UPDATE users SET lastLoginAt = ? WHERE id = ?").run(at, id);
  }

  delete(id: string): boolean {
    const res = this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
    return Number(res.changes) > 0;
  }
}
