import type { ConnectionCredentials, Platform, PlatformConnection } from "@socmedia/shared";
import type { Db, Row } from "../database";
import { decrypt, encrypt } from "../../crypto";

function encryptCreds(c: ConnectionCredentials): ConnectionCredentials {
  return {
    ...c,
    clientSecret: c.clientSecret ? encrypt(c.clientSecret) : "",
    accessToken: c.accessToken ? encrypt(c.accessToken) : c.accessToken ?? null,
    refreshToken: c.refreshToken ? encrypt(c.refreshToken) : c.refreshToken ?? null,
  };
}

function decryptCreds(c: ConnectionCredentials): ConnectionCredentials {
  return {
    ...c,
    clientSecret: c.clientSecret ? decrypt(c.clientSecret) : "",
    accessToken: c.accessToken ? decrypt(c.accessToken) : c.accessToken ?? null,
    refreshToken: c.refreshToken ? decrypt(c.refreshToken) : c.refreshToken ?? null,
  };
}

function rowToConnection(row: Row): PlatformConnection {
  const storedCreds: ConnectionCredentials = JSON.parse(row.credentials);
  return {
    id: row.id,
    orgId: row.orgId,
    platform: row.platform as Platform,
    label: row.label ?? "",
    enabled: !!row.enabled,
    mode: row.mode,
    status: row.status,
    displayName: row.displayName,
    handle: row.handle,
    avatarUrl: row.avatarUrl ?? null,
    followers: row.followers,
    credentials: decryptCreds(storedCreds),
    settings: JSON.parse(row.settings),
    lastTest: row.lastTest ? JSON.parse(row.lastTest) : null,
    connectedAt: row.connectedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ConnectionsRepo {
  constructor(private db: Db) {}

  listByOrg(orgId: string): PlatformConnection[] {
    const rows = this.db.prepare("SELECT * FROM connections WHERE orgId = ? ORDER BY platform ASC").all(orgId) as Row[];
    return rows.map(rowToConnection);
  }

  get(id: string): PlatformConnection | undefined {
    const row = this.db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToConnection(row) : undefined;
  }

  /** First (oldest) connection for a platform; kept for callers that only need one. */
  getByOrgAndPlatform(orgId: string, platform: Platform): PlatformConnection | undefined {
    const row = this.db.prepare("SELECT * FROM connections WHERE orgId = ? AND platform = ? ORDER BY createdAt ASC LIMIT 1").get(orgId, platform) as Row | undefined;
    return row ? rowToConnection(row) : undefined;
  }

  listByOrgAndPlatform(orgId: string, platform: Platform): PlatformConnection[] {
    const rows = this.db.prepare("SELECT * FROM connections WHERE orgId = ? AND platform = ? ORDER BY createdAt ASC").all(orgId, platform) as Row[];
    return rows.map(rowToConnection);
  }

  delete(id: string): boolean {
    const res = this.db.prepare("DELETE FROM connections WHERE id = ?").run(id);
    return Number(res.changes) > 0;
  }

  create(conn: PlatformConnection): PlatformConnection {
    this.db
      .prepare(
        `INSERT INTO connections (id, orgId, platform, label, enabled, mode, status, displayName, handle, avatarUrl, followers, credentials, settings, lastTest, connectedAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        conn.id,
        conn.orgId,
        conn.platform,
        conn.label ?? "",
        conn.enabled ? 1 : 0,
        conn.mode,
        conn.status,
        conn.displayName,
        conn.handle,
        conn.avatarUrl ?? null,
        conn.followers,
        JSON.stringify(encryptCreds(conn.credentials)),
        JSON.stringify(conn.settings),
        conn.lastTest ? JSON.stringify(conn.lastTest) : null,
        conn.connectedAt ?? null,
        conn.createdAt,
        conn.updatedAt
      );
    return this.get(conn.id)!;
  }

  /** Full replace-save of a connection (routes merge patches into a full object first). */
  save(conn: PlatformConnection): PlatformConnection {
    this.db
      .prepare(
        `UPDATE connections SET label=?, enabled=?, mode=?, status=?, displayName=?, handle=?, avatarUrl=?, followers=?, credentials=?, settings=?, lastTest=?, connectedAt=?, updatedAt=?
         WHERE id=?`
      )
      .run(
        conn.label ?? "",
        conn.enabled ? 1 : 0,
        conn.mode,
        conn.status,
        conn.displayName,
        conn.handle,
        conn.avatarUrl ?? null,
        conn.followers,
        JSON.stringify(encryptCreds(conn.credentials)),
        JSON.stringify(conn.settings),
        conn.lastTest ? JSON.stringify(conn.lastTest) : null,
        conn.connectedAt ?? null,
        conn.updatedAt,
        conn.id
      );
    return this.get(conn.id)!;
  }
}
