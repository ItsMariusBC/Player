import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  id: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    sql: `
CREATE TABLE users (id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, display_name TEXT, email TEXT, groups TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, UNIQUE(issuer, subject));
CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, refresh_token_sealed TEXT, id_token_sealed TEXT, groups_checked_at TEXT NOT NULL);
CREATE INDEX sessions_user_id ON sessions(user_id);
`,
  },
];

/** Applies pending migrations in id order, one transaction each. Returns how many ran. */
export function migrate(db: DatabaseSync): number {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT)");
  const rows = db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[];
  const applied = new Set(rows.map((row) => row.id));
  const pending = MIGRATIONS.filter((m) => !applied.has(m.id)).sort((a, b) => a.id - b.id);
  for (const migration of pending) {
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
        migration.id,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return pending.length;
}
