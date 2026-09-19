import type { Db, Row } from "../database";

/** Simple key/value store for workspace-wide settings (JSON values). */
export class SettingsRepo {
  constructor(private db: Db) {}

  get<T>(key: string): { value: T; updatedAt: string } | undefined {
    const row = this.db.prepare("SELECT value, updatedAt FROM app_settings WHERE key = ?").get(key) as Row | undefined;
    if (!row) return undefined;
    try {
      return { value: JSON.parse(row.value) as T, updatedAt: row.updatedAt };
    } catch {
      return undefined;
    }
  }

  set<T>(key: string, value: T): void {
    this.db
      .prepare("INSERT INTO app_settings (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt")
      .run(key, JSON.stringify(value), new Date().toISOString());
  }

  delete(key: string): void {
    this.db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
  }
}
