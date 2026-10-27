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
  {
    id: 2,
    sql: `
CREATE TABLE folders (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES folders(id) ON DELETE RESTRICT, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(parent_id, name));
CREATE TABLE tracks (id TEXT PRIMARY KEY, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, title TEXT NOT NULL, artist TEXT NOT NULL DEFAULT '', album TEXT NOT NULL DEFAULT '', duration_ms INTEGER, format TEXT NOT NULL CHECK (format IN ('flac','mp3','wav')), size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL UNIQUE, cover_ext TEXT, status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','failed')), position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX tracks_folder_position ON tracks(folder_id, position);
CREATE TABLE imports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('processing','ready','failed')), error TEXT, track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE admin_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, track_id TEXT, folder_id TEXT, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE favorites (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY (user_id, track_id));
`,
  },
  {
    id: 3,
    sql: `
CREATE TABLE song_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT,
  year INTEGER,
  source TEXT NOT NULL CHECK (source IN ('musicbrainz','deezer','itunes','manual')),
  cover_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX song_requests_status_created ON song_requests(status, created_at);
CREATE INDEX song_requests_user ON song_requests(user_id);
`,
  },
  {
    id: 4,
    sql: `
ALTER TABLE tracks ADD COLUMN loudness_lufs REAL;
ALTER TABLE tracks ADD COLUMN true_peak_dbtp REAL;
`,
  },
  {
    id: 5,
    sql: `
ALTER TABLE tracks ADD COLUMN loudness_measured_at TEXT;
`,
  },
  {
    id: 6,
    sql: `
ALTER TABLE imports ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE imports ADD COLUMN source_url TEXT;
`,
  },
  {
    id: 7,
    sql: `
CREATE TABLE song_requests_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT,
  year INTEGER,
  source TEXT NOT NULL CHECK (source IN ('musicbrainz','deezer','itunes','manual')),
  cover_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','added','rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  reject_reason TEXT
);
INSERT INTO song_requests_new (id, user_id, title, artist, album, year, source, cover_url, status, created_at, updated_at)
  SELECT id, user_id, title, artist, album, year, source, cover_url, status, created_at, updated_at FROM song_requests;
DROP TABLE song_requests;
ALTER TABLE song_requests_new RENAME TO song_requests;
CREATE INDEX song_requests_status_created ON song_requests(status, created_at);
CREATE INDEX song_requests_user ON song_requests(user_id);
ALTER TABLE imports ADD COLUMN request_id TEXT REFERENCES song_requests(id) ON DELETE SET NULL;
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
