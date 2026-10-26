import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, it } from "node:test";
import { createSession, deleteSession, findSession } from "../src/auth/sessions.ts";
import { upsertUser } from "../src/auth/users.ts";
import { openDatabase } from "../src/db.ts";
import { migrate } from "../src/migrations.ts";

const key = Buffer.alloc(32, 1);
const now = new Date("2026-01-01T00:00:00.000Z");
const identity = { issuer: "https://idp.test", subject: "sub-1" };

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
});

describe("upsertUser", () => {
  it("keeps the id and updates groups on a second call", () => {
    const first = upsertUser(db, { ...identity, groups: ["a"] }, now);
    const second = upsertUser(db, { ...identity, displayName: "Ada", groups: ["a", "b"] }, now);
    assert.equal(second.id, first.id);
    assert.deepEqual(second.groups, ["a", "b"]);
    assert.equal(second.displayName, "Ada");
  });
});

describe("sessions", () => {
  it("creates a session and finds it with the decrypted refresh token", () => {
    const user = upsertUser(db, { ...identity, groups: [] }, now);
    const created = createSession(
      db,
      key,
      { userId: user.id, refreshToken: "refresh-1", ttlMs: 1000 },
      now,
    );
    const found = findSession(db, key, created.id, now);
    assert.equal(found?.id, created.id);
    assert.equal(found?.userId, user.id);
    assert.equal(found?.refreshToken, "refresh-1");
    assert.equal(found?.idToken, null);
  });

  it("returns null for an unknown id", () => {
    assert.equal(findSession(db, key, "unknown", now), null);
  });

  it("returns null and deletes an expired session", () => {
    const user = upsertUser(db, { ...identity, groups: [] }, now);
    const created = createSession(db, key, { userId: user.id, ttlMs: 1000 }, now);
    assert.equal(findSession(db, key, created.id, new Date(now.getTime() + 2000)), null);
    const row = db.prepare("SELECT COUNT(*) AS n FROM sessions").get();
    assert.equal(row?.n, 0);
  });

  it("returns null after deleteSession", () => {
    const user = upsertUser(db, { ...identity, groups: [] }, now);
    const created = createSession(db, key, { userId: user.id, ttlMs: 1000 }, now);
    deleteSession(db, created.id);
    assert.equal(findSession(db, key, created.id, now), null);
  });

  it("never stores the refresh token in clear", () => {
    const user = upsertUser(db, { ...identity, groups: [] }, now);
    createSession(db, key, { userId: user.id, refreshToken: "refresh-secret", ttlMs: 1000 }, now);
    const row = db.prepare("SELECT refresh_token_sealed AS sealed FROM sessions").get();
    assert.equal(typeof row?.sealed, "string");
    assert.ok(!String(row?.sealed).includes("refresh-secret"));
  });
});
