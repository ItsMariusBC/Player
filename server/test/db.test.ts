import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDatabase } from "../src/db.ts";
import { migrate } from "../src/migrations.ts";

describe("database", () => {
  it("applies migrations once and is idempotent", () => {
    const db = openDatabase(":memory:");
    assert.equal(migrate(db), 1);
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
