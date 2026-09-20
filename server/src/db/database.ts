import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type Db = DatabaseSync;
/** Loosely typed row shape coming back from node:sqlite (values are string|number|bigint|Buffer|null). */
export type Row = Record<string, any>;

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  brandColor TEXT NOT NULL,
  timezone TEXT NOT NULL,
  logoUrl TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'sandbox',
  status TEXT NOT NULL DEFAULT 'disconnected',
  displayName TEXT NOT NULL DEFAULT '',
  handle TEXT NOT NULL DEFAULT '',
  avatarUrl TEXT,
  followers INTEGER NOT NULL DEFAULT 0,
  credentials TEXT NOT NULL,
  settings TEXT NOT NULL,
  lastTest TEXT,
  connectedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  durationSeconds REAL,
  url TEXT NOT NULL,
  thumbnailUrl TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  sourceAssetId TEXT,
  format TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '[]',
  mediaIds TEXT NOT NULL DEFAULT '[]',
  targets TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduledAt TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  publishMode TEXT NOT NULL DEFAULT 'all',
  queueSpacingMinutes INTEGER NOT NULL DEFAULT 10,
  labels TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  publishedAt TEXT
);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  postId TEXT NOT NULL,
  connectionId TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  externalId TEXT,
  externalUrl TEXT,
  error TEXT,
  log TEXT NOT NULL DEFAULT '[]',
  runAt TEXT,
  startedAt TEXT,
  finishedAt TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connectionId TEXT NOT NULL,
  platform TEXT NOT NULL,
  postId TEXT,
  date TEXT NOT NULL,
  followers INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  engagementRate REAL NOT NULL DEFAULT 0,
  UNIQUE(connectionId, date)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  orgIds TEXT NOT NULL DEFAULT '[]',
  passwordHash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  mustChangePassword INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  lastLoginAt TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
CREATE INDEX IF NOT EXISTS idx_connections_org ON connections(orgId);
CREATE INDEX IF NOT EXISTS idx_media_org ON media(orgId);
CREATE INDEX IF NOT EXISTS idx_posts_org ON posts(orgId);
CREATE INDEX IF NOT EXISTS idx_posts_scheduledAt ON posts(scheduledAt);
CREATE INDEX IF NOT EXISTS idx_jobs_org ON publish_jobs(orgId);
CREATE INDEX IF NOT EXISTS idx_jobs_post ON publish_jobs(postId);
CREATE INDEX IF NOT EXISTS idx_metrics_org ON metric_snapshots(orgId);
CREATE INDEX IF NOT EXISTS idx_metrics_connection ON metric_snapshots(connectionId);
`;

/** Opens (and migrates) the SQLite database at `location`, or an in-memory db for ":memory:". */
export function openDatabase(location: string): Db {
  if (location !== ":memory:") {
    fs.mkdirSync(path.dirname(location), { recursive: true });
  }
  const db = new DatabaseSync(location);
  db.exec("PRAGMA foreign_keys = ON;");
  if (location !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  db.exec(MIGRATIONS);
  runIncrementalMigrations(db);
  return db;
}

function hasColumn(db: Db, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

function hasTable(db: Db, table: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name: string } | undefined;
  return !!row;
}

/** Additive migrations for databases created by earlier versions. Safe to run repeatedly. */
export function runIncrementalMigrations(db: Db): void {
  if (!hasColumn(db, "connections", "label")) db.exec("ALTER TABLE connections ADD COLUMN label TEXT NOT NULL DEFAULT ''");
  if (!hasColumn(db, "posts", "publishMode")) db.exec("ALTER TABLE posts ADD COLUMN publishMode TEXT NOT NULL DEFAULT 'all'");
  if (!hasColumn(db, "posts", "queueSpacingMinutes")) db.exec("ALTER TABLE posts ADD COLUMN queueSpacingMinutes INTEGER NOT NULL DEFAULT 10");
  if (!hasColumn(db, "publish_jobs", "runAt")) db.exec("ALTER TABLE publish_jobs ADD COLUMN runAt TEXT");

  if (!hasColumn(db, "users", "googleSub")) db.exec("ALTER TABLE users ADD COLUMN googleSub TEXT");

  if (!hasTable(db, "login_tokens")) {
    db.exec(`
      CREATE TABLE login_tokens (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        tokenHash TEXT NOT NULL UNIQUE,
        purpose TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        usedAt TEXT,
        createdAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_login_tokens_email ON login_tokens(email);
    `);
  }

  if (!hasTable(db, "access_requests")) {
    db.exec(`
      CREATE TABLE access_requests (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        organization TEXT,
        message TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        createdAt TEXT NOT NULL,
        decidedAt TEXT,
        decidedBy TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);
    `);
  }

  if (!hasTable(db, "quick_post_tokens")) {
    db.exec(`
      CREATE TABLE quick_post_tokens (
        id TEXT PRIMARY KEY,
        orgId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        userId TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        tokenHash TEXT NOT NULL UNIQUE,
        tokenPreview TEXT NOT NULL,
        connectionIds TEXT NOT NULL DEFAULT '[]',
        publishMode TEXT NOT NULL DEFAULT 'all',
        active INTEGER NOT NULL DEFAULT 1,
        usesCount INTEGER NOT NULL DEFAULT 0,
        lastUsedAt TEXT,
        createdAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quick_post_tokens_org ON quick_post_tokens(orgId);
    `);
  }

  if (!hasTable(db, "inbound_bindings")) {
    db.exec(`
      CREATE TABLE inbound_bindings (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        senderId TEXT NOT NULL,
        senderLabel TEXT,
        userId TEXT NOT NULL,
        orgId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        connectionIds TEXT NOT NULL DEFAULT '[]',
        publishMode TEXT NOT NULL DEFAULT 'all',
        confirmBeforePosting INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        verificationCode TEXT,
        createdAt TEXT NOT NULL,
        verifiedAt TEXT,
        lastMessageAt TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_inbound_bindings_channel_sender ON inbound_bindings(channel, senderId);
      CREATE INDEX IF NOT EXISTS idx_inbound_bindings_org ON inbound_bindings(orgId);
    `);
  }

  if (!hasTable(db, "inbound_messages")) {
    db.exec(`
      CREATE TABLE inbound_messages (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        providerMessageId TEXT NOT NULL,
        senderId TEXT NOT NULL,
        bindingId TEXT,
        orgId TEXT,
        userId TEXT,
        text TEXT NOT NULL DEFAULT '',
        mediaCount INTEGER NOT NULL DEFAULT 0,
        hasAudio INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'received',
        postId TEXT,
        mediaIds TEXT NOT NULL DEFAULT '[]',
        links TEXT NOT NULL DEFAULT '[]',
        reply TEXT,
        repliedBy TEXT,
        error TEXT,
        timeline TEXT NOT NULL DEFAULT '[]',
        receivedAt TEXT NOT NULL,
        completedAt TEXT,
        UNIQUE(channel, providerMessageId)
      );
      CREATE INDEX IF NOT EXISTS idx_inbound_messages_org ON inbound_messages(orgId);
      CREATE INDEX IF NOT EXISTS idx_inbound_messages_sender ON inbound_messages(channel, senderId);
      CREATE INDEX IF NOT EXISTS idx_inbound_messages_received ON inbound_messages(receivedAt);
    `);
  }

  // Multiple accounts per platform: drop the old UNIQUE(orgId, platform) constraint by rebuilding the table.
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'connections'").get() as { sql: string } | undefined;
  if (ddl && /UNIQUE\s*\(\s*orgId\s*,\s*platform\s*\)/i.test(ddl.sql)) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE connections_new (
        id TEXT PRIMARY KEY,
        orgId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        mode TEXT NOT NULL DEFAULT 'sandbox',
        status TEXT NOT NULL DEFAULT 'disconnected',
        displayName TEXT NOT NULL DEFAULT '',
        handle TEXT NOT NULL DEFAULT '',
        avatarUrl TEXT,
        followers INTEGER NOT NULL DEFAULT 0,
        credentials TEXT NOT NULL,
        settings TEXT NOT NULL,
        lastTest TEXT,
        connectedAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      INSERT INTO connections_new (id, orgId, platform, label, enabled, mode, status, displayName, handle, avatarUrl, followers, credentials, settings, lastTest, connectedAt, createdAt, updatedAt)
        SELECT id, orgId, platform, label, enabled, mode, status, displayName, handle, avatarUrl, followers, credentials, settings, lastTest, connectedAt, createdAt, updatedAt FROM connections;
      DROP TABLE connections;
      ALTER TABLE connections_new RENAME TO connections;
      CREATE INDEX IF NOT EXISTS idx_connections_org ON connections(orgId);
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }
}
