import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inTransaction } from "../src/catalog/tx.ts";
import { openDatabase } from "../src/db.ts";

function freshDb() {
  const db = openDatabase(":memory:");
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
  return db;
}

describe("inTransaction", () => {
  it("nests and rolls back only the inner savepoint", () => {
    const db = freshDb();
    inTransaction(db, () => {
      db.exec("INSERT INTO items (name) VALUES ('outer')");
      assert.throws(() =>
        inTransaction(db, () => {
          db.exec("INSERT INTO items (name) VALUES ('inner')");
          throw new Error("inner");
        }),
      );
    });
    const rows = db.prepare("SELECT name FROM items").all() as { name: string }[];
    assert.deepEqual(
      rows.map((r) => r.name),
      ["outer"],
    );
  });

  it("rethrows the original error when SQLite already rolled back", () => {
    const db = freshDb();
    db.exec(
      "CREATE TRIGGER stop BEFORE INSERT ON items WHEN NEW.name = 'bad' BEGIN SELECT RAISE(ROLLBACK, 'original failure'); END",
    );
    assert.throws(
      () => inTransaction(db, () => db.exec("INSERT INTO items (name) VALUES ('bad')")),
      /original failure/,
    );
    // The helper is still usable afterwards.
    inTransaction(db, () => db.exec("INSERT INTO items (name) VALUES ('ok')"));
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n, 1);
  });

  it("propagates a failing SAVEPOINT and stays usable", () => {
    const db = freshDb();
    db.close();
    assert.throws(() => inTransaction(db, () => 1));
    const other = freshDb();
    assert.equal(
      inTransaction(other, () => 42),
      42,
    );
  });
});
