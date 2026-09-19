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
  updatedAt TEXT NOT NULL,
  UNIQUE(orgId, platform)
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
  return db;
}
