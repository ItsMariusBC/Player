import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, it } from "node:test";
import { openDatabase } from "../src/db.ts";
import { migrate } from "../src/migrations.ts";
import {
  RequestDuplicate,
  RequestLimit,
  acceptRequest,
  countPending,
  createRequest,
  deleteRequest,
  findRequest,
  hasPendingDuplicate,
  listAllRequests,
  listUserRequests,
  normalizeKey,
  toRequestDto,
  type RequestInput,
} from "../src/requests/repo.ts";

let db: DatabaseSync;

const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));

function addUser(id: string, name: string | null = id): void {
  db.prepare(
    "INSERT INTO users (id, issuer, subject, display_name, created_at, last_seen_at) VALUES (?, 'i', ?, ?, 'a', 'a')",
  ).run(id, id, name);
}

const input = (over: Partial<RequestInput> = {}): RequestInput => ({
  userId: "u1",
  title: "Song",
  artist: "Artist",
  album: null,
  year: null,
  source: "manual",
  coverUrl: null,
  ...over,
});

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  addUser("u1", "Alice");
  addUser("u2", "Bob");
});

describe("song request repository", () => {
  it("applies migration 3", () => {
    const row = db.prepare("SELECT id FROM schema_migrations WHERE id = 3").get();
    assert.ok(row);
  });

  it("inserts a request and maps it to the DTO", () => {
    const row = createRequest(
      db,
      input({ album: "Album", year: 1999, source: "deezer", coverUrl: "https://cdn.test/c.jpg" }),
      at(1),
    );
    assert.deepEqual(toRequestDto(row), {
      id: row.id,
      title: "Song",
      artist: "Artist",
      album: "Album",
      year: 1999,
      source: "deezer",
      coverUrl: "https://cdn.test/c.jpg",
      status: "pending",
      createdAt: at(1).toISOString(),
      updatedAt: at(1).toISOString(),
    });
    assert.deepEqual(toRequestDto(row, { withUser: true }).requestedBy, {
      id: "u1",
      displayName: "Alice",
    });
  });

  it("refuses a 21st pending request but counts per user", () => {
    for (let i = 0; i < 20; i++) createRequest(db, input({ title: `Song ${i}` }), at(i));
    assert.equal(countPending(db, "u1"), 20);
    assert.throws(() => createRequest(db, input({ title: "One more" }), at(30)), RequestLimit);
    createRequest(db, input({ userId: "u2", title: "One more" }), at(31));
  });

  it("frees a slot once a request is accepted", () => {
    const first = createRequest(db, input({ title: "Song 0" }), at(0));
    for (let i = 1; i < 20; i++) createRequest(db, input({ title: `Song ${i}` }), at(i));
    acceptRequest(db, first.id, at(40));
    createRequest(db, input({ title: "One more" }), at(41));
  });

  it("detects duplicates ignoring case, accents composition and spaces", () => {
    createRequest(db, input({ title: "Café  Del Mar", artist: "Énergie" }), at(1));
    assert.throws(
      () => createRequest(db, input({ title: " café del   MAR ", artist: "Énergie" }), at(2)),
      RequestDuplicate,
    );
    assert.equal(hasPendingDuplicate(db, "u1", "CAFÉ DEL MAR", "énergie"), true);
    assert.equal(hasPendingDuplicate(db, "u2", "Café Del Mar", "Énergie"), false);
    assert.equal(hasPendingDuplicate(db, "u1", "Café Del Mar", "Other"), false);
    assert.equal(normalizeKey("A  B", "C"), normalizeKey("a b", " c "));
  });

  it("ignores an accepted request when checking duplicates", () => {
    const row = createRequest(db, input(), at(1));
    acceptRequest(db, row.id, at(2));
    createRequest(db, input(), at(3));
  });

  it("lists pending first, then accepted, most recent first, with the user name", () => {
    const a = createRequest(db, input({ title: "A" }), at(1));
    const b = createRequest(db, input({ userId: "u2", title: "B" }), at(2));
    const c = createRequest(db, input({ title: "C" }), at(3));
    acceptRequest(db, c.id, at(4));
    const all = listAllRequests(db);
    assert.deepEqual(
      all.map((r) => r.id),
      [b.id, a.id, c.id],
    );
    assert.equal(toRequestDto(all[0]!, { withUser: true }).requestedBy?.displayName, "Bob");
    assert.equal(listAllRequests(db, 2).length, 2);
    assert.deepEqual(
      listUserRequests(db, "u1").map((r) => r.id),
      [c.id, a.id],
    );
    assert.equal(listUserRequests(db, "u1", 1).length, 1);
  });

  it("accepts once, then reports not_pending; null when absent", () => {
    const row = createRequest(db, input(), at(1));
    const accepted = acceptRequest(db, row.id, at(5));
    assert.ok(accepted && accepted !== "not_pending");
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.updated_at, at(5).toISOString());
    assert.equal(acceptRequest(db, row.id, at(6)), "not_pending");
    assert.equal(acceptRequest(db, "missing", at(6)), null);
  });

  it("deletes only the owner's pending request when restricted", () => {
    const mine = createRequest(db, input({ title: "Mine" }), at(1));
    const done = createRequest(db, input({ title: "Done" }), at(2));
    acceptRequest(db, done.id, at(3));
    const opts = { userId: "u2", pendingOnly: true };
    assert.equal(deleteRequest(db, mine.id, opts), false);
    assert.ok(findRequest(db, mine.id));
    assert.equal(deleteRequest(db, done.id, { userId: "u1", pendingOnly: true }), false);
    assert.equal(deleteRequest(db, mine.id, { userId: "u1", pendingOnly: true }), true);
    assert.equal(findRequest(db, mine.id), null);
    assert.equal(deleteRequest(db, done.id), true);
    assert.equal(deleteRequest(db, done.id), false);
  });
});
