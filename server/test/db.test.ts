import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDatabase } from "../src/db.ts";
import { migrate } from "../src/migrations.ts";

describe("database", () => {
  it("applies migrations once and is idempotent", () => {
    const db = openDatabase(":memory:");
    assert.equal(migrate(db), 2);
    assert.equal(migrate(db), 0);
    db.close();
  });

  it("enables WAL (or memory for in-memory databases)", () => {
    const db = openDatabase(":memory:");
    const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    assert.ok(["memory", "wal"].includes(row.journal_mode));
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
