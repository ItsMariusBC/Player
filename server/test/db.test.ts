import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDatabase } from "../src/db.ts";
import { MIGRATIONS, migrate } from "../src/migrations.ts";

describe("database", () => {
  it("applies migrations once and is idempotent", () => {
    const db = openDatabase(":memory:");
    assert.equal(migrate(db), 8);
    assert.equal(migrate(db), 0);
    db.close();
  });

  it("adds the light variant columns in migration 8", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const columns = (db.prepare("PRAGMA table_info(tracks)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    assert.ok(columns.includes("aac_size_bytes"));
    assert.ok(columns.includes("aac_attempted_at"));
    db.close();
  });

  it("enables WAL (or memory for in-memory databases)", () => {
    const db = openDatabase(":memory:");
    const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    assert.ok(["memory", "wal"].includes(row.journal_mode));
    db.close();
  });

  it("waits up to 5 s on a locked database", () => {
    const db = openDatabase(":memory:");
    const row = db.prepare("PRAGMA busy_timeout").get() as { timeout: number };
    assert.equal(row.timeout, 5000);
    db.close();
  });

  it("enforces foreign keys on sessions", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO sessions (id_hash, user_id, created_at, expires_at, groups_checked_at) VALUES ('h', 'missing', 'a', 'b', 'c')",
          )
          .run(),
      /FOREIGN KEY/,
    );
    db.close();
  });
});

describe("catalogue tables", () => {
  it("rejects a track with an unsupported format", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO tracks (id, title, format, size_bytes, sha256, created_at, updated_at) VALUES ('t', 'T', 'ogg', 1, 'x', 'a', 'a')",
          )
          .run(),
      /CHECK constraint/,
    );
    db.close();
  });

  it("rejects two folders with the same name under the same parent", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const insert = db.prepare(
      "INSERT INTO folders (id, parent_id, name, created_at) VALUES (?, ?, ?, 'a')",
    );
    insert.run("root", null, "Root");
    insert.run("f1", "root", "Rock");
    assert.throws(() => insert.run("f2", "root", "Rock"), /UNIQUE constraint/);
    db.close();
  });

  it("allows the same folder name under different parents", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const insert = db.prepare(
      "INSERT INTO folders (id, parent_id, name, created_at) VALUES (?, ?, ?, 'a')",
    );
    insert.run("a", null, "A");
    insert.run("b", null, "B");
    insert.run("a1", "a", "Rock");
    insert.run("b1", "b", "Rock");
    db.close();
  });
});

describe("song_requests table", () => {
  it("is created by migration 3 and rejects an unknown source or status", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    db.prepare(
      "INSERT INTO users (id, issuer, subject, created_at, last_seen_at) VALUES ('u', 'i', 's', 'a', 'a')",
    ).run();
    const insert = db.prepare(
      "INSERT INTO song_requests (id, user_id, title, source, status, created_at, updated_at) VALUES (?, 'u', 'T', ?, ?, 'a', 'a')",
    );
    insert.run("ok", "manual", "pending");
    assert.throws(() => insert.run("bad1", "spotify", "pending"), /CHECK constraint/);
    assert.throws(() => insert.run("bad2", "manual", "done"), /CHECK constraint/);
    db.prepare("DELETE FROM users WHERE id = 'u'").run();
    const count = db.prepare("SELECT COUNT(*) AS n FROM song_requests").get() as { n: number };
    assert.equal(count.n, 0);
    db.close();
  });
});

describe("tracks loudness columns", () => {
  it("are created by migrations 4 and 5 and accept NULL", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const columns = db.prepare("PRAGMA table_info(tracks)").all() as { name: string }[];
    const names = columns.map((c) => c.name);
    assert.ok(names.includes("loudness_lufs"));
    assert.ok(names.includes("loudness_measured_at"));
    assert.ok(names.includes("true_peak_dbtp"));
    db.prepare(
      "INSERT INTO tracks (id, title, format, size_bytes, sha256, created_at, updated_at) VALUES ('t', 'T', 'wav', 1, 'h', 'a', 'a')",
    ).run();
    const row = db.prepare("SELECT loudness_lufs, true_peak_dbtp FROM tracks").get() as {
      loudness_lufs: number | null;
      true_peak_dbtp: number | null;
    };
    assert.equal(row.loudness_lufs, null);
    assert.equal(row.true_peak_dbtp, null);
    db.close();
  });
});

describe("imports folder and source columns", () => {
  it("are created by migration 6, accept NULL and null the folder on delete", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const names = (db.prepare("PRAGMA table_info(imports)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    assert.ok(names.includes("folder_id"));
    assert.ok(names.includes("source_url"));
    db.prepare(
      "INSERT INTO users (id, issuer, subject, created_at, last_seen_at) VALUES ('u', 'i', 's', 'a', 'a')",
    ).run();
    db.prepare("INSERT INTO folders (id, name, created_at) VALUES ('f', 'F', 'a')").run();
    db.prepare(
      "INSERT INTO imports (id, user_id, filename, state, folder_id, source_url, created_at, updated_at) VALUES ('i1', 'u', 'a.wav', 'processing', 'f', 'https://x/a.wav', 'a', 'a')",
    ).run();
    db.prepare(
      "INSERT INTO imports (id, user_id, filename, state, created_at, updated_at) VALUES ('i2', 'u', 'b.wav', 'processing', 'a', 'a')",
    ).run();
    db.prepare("DELETE FROM folders WHERE id = 'f'").run();
    const rows = db
      .prepare("SELECT id, folder_id, source_url FROM imports ORDER BY id")
      .all() as any[];
    assert.equal(rows[0].folder_id, null);
    assert.equal(rows[0].source_url, "https://x/a.wav");
    assert.equal(rows[1].source_url, null);
    db.close();
  });
});

describe("migration 7: song request lifecycle", () => {
  const upTo = (db: ReturnType<typeof openDatabase>, id: number) => {
    db.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT)");
    for (const m of MIGRATIONS.filter((x) => x.id <= id)) {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, 'a')").run(m.id);
    }
  };

  it("rebuilds song_requests keeping rows and indexes, and widens the statuses", () => {
    const db = openDatabase(":memory:");
    upTo(db, 6);
    db.prepare(
      "INSERT INTO users (id, issuer, subject, created_at, last_seen_at) VALUES ('u', 'i', 's', 'a', 'a')",
    ).run();
    const insert = db.prepare(
      "INSERT INTO song_requests (id, user_id, title, artist, album, year, source, cover_url, status, created_at, updated_at) VALUES (?, 'u', ?, 'Art', 'Alb', 1999, 'deezer', 'https://c/x', ?, 'c', 'd')",
    );
    insert.run("r1", "One", "pending");
    insert.run("r2", "Two", "accepted");
    assert.equal(migrate(db), 2);
    const rows = db.prepare("SELECT * FROM song_requests ORDER BY id").all() as any[];
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => [r.id, r.title, r.artist, r.album, r.year, r.source, r.cover_url, r.status]),
      [
        ["r1", "One", "Art", "Alb", 1999, "deezer", "https://c/x", "pending"],
        ["r2", "Two", "Art", "Alb", 1999, "deezer", "https://c/x", "accepted"],
      ],
    );
    assert.equal(rows[0].track_id, null);
    assert.equal(rows[0].reject_reason, null);
    assert.equal(rows[0].created_at, "c");
    assert.equal(rows[0].updated_at, "d");
    const indexes = (
      db.prepare("PRAGMA index_list(song_requests)").all() as { name: string }[]
    ).map((i) => i.name);
    assert.ok(indexes.includes("song_requests_status_created"));
    assert.ok(indexes.includes("song_requests_user"));
    assert.equal(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'song_requests_new'").get(),
      undefined,
    );
    const insertNew = db.prepare(
      "INSERT INTO song_requests (id, user_id, title, source, status, created_at, updated_at) VALUES (?, 'u', 'T', 'manual', ?, 'a', 'a')",
    );
    insertNew.run("r3", "added");
    insertNew.run("r4", "rejected");
    assert.throws(() => insertNew.run("r5", "done"), /CHECK constraint/);
    db.close();
  });

  it("links a track (nulled when it is deleted) and adds imports.request_id", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    db.prepare(
      "INSERT INTO users (id, issuer, subject, created_at, last_seen_at) VALUES ('u', 'i', 's', 'a', 'a')",
    ).run();
    db.prepare(
      "INSERT INTO tracks (id, title, format, size_bytes, sha256, created_at, updated_at) VALUES ('t', 'T', 'wav', 1, 'h', 'a', 'a')",
    ).run();
    db.prepare(
      "INSERT INTO song_requests (id, user_id, title, source, status, track_id, created_at, updated_at) VALUES ('r', 'u', 'T', 'manual', 'added', 't', 'a', 'a')",
    ).run();
    db.prepare(
      "INSERT INTO imports (id, user_id, filename, state, request_id, created_at, updated_at) VALUES ('i', 'u', 'a.wav', 'processing', 'r', 'a', 'a')",
    ).run();
    db.prepare("DELETE FROM tracks WHERE id = 't'").run();
    assert.equal((db.prepare("SELECT track_id FROM song_requests").get() as any).track_id, null);
    db.prepare("DELETE FROM song_requests WHERE id = 'r'").run();
    assert.equal((db.prepare("SELECT request_id FROM imports").get() as any).request_id, null);
    db.close();
  });
});
