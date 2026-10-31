import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, it } from "node:test";
import {
  createFolder,
  deleteFolder,
  isDescendant,
  listFolders,
  moveFolder,
  renameFolder,
} from "../src/catalog/folders.ts";
import {
  deleteTrack,
  findTrackBySha,
  getTrack,
  insertTrack,
  listTracks,
  moveTrack,
  renumber,
  updateTrack,
} from "../src/catalog/tracks.ts";
import {
  FolderConflictError,
  FolderCycleError,
  FolderNotEmptyError,
  NotFoundError,
} from "../src/catalog/types.ts";
import { openDatabase } from "../src/db.ts";
import { migrate } from "../src/migrations.ts";

const now = new Date("2026-01-01T00:00:00.000Z");

let db: DatabaseSync;
let counter = 0;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  counter = 0;
});

function addTrack(
  folderId: string | null,
  title = `t${counter}`,
  status: "ready" | "failed" = "ready",
) {
  counter += 1;
  return insertTrack(
    db,
    {
      id: crypto.randomUUID(),
      folderId,
      title,
      artist: "",
      album: "",
      durationMs: null,
      format: "mp3",
      sizeBytes: 10,
      sha256: `sha-${counter}`,
      coverExt: null,
      status,
    },
    now,
  );
}

function positions(folderId: string | null): string[] {
  return listTracks(db)
    .filter((t) => t.folderId === folderId)
    .map((t) => `${t.title}:${t.position}`);
}

describe("folders", () => {
  it("creates, renames and lists folders", () => {
    const a = createFolder(db, { parentId: null, name: "A" }, now);
    const b = createFolder(db, { parentId: a.id, name: "B" }, now);
    const c = createFolder(db, { parentId: a.id, name: "C" }, now);
    assert.equal(b.position, 0);
    assert.equal(c.position, 1);
    const renamed = renameFolder(db, c.id, "C2", now);
    assert.equal(renamed.name, "C2");
    assert.deepEqual(
      listFolders(db).map((f) => f.name),
      ["A", "B", "C2"],
    );
    assert.throws(() => renameFolder(db, "missing", "x", now), NotFoundError);
  });

  it("refuses duplicate names under a parent", () => {
    const a = createFolder(db, { parentId: null, name: "A" }, now);
    createFolder(db, { parentId: a.id, name: "X" }, now);
    assert.throws(() => createFolder(db, { parentId: a.id, name: "X" }, now), FolderConflictError);
    const y = createFolder(db, { parentId: a.id, name: "Y" }, now);
    assert.throws(() => renameFolder(db, y.id, "X", now), FolderConflictError);
  });

  it("refuses duplicate names at the root", () => {
    const a = createFolder(db, { parentId: null, name: "A" }, now);
    assert.throws(() => createFolder(db, { parentId: null, name: "A" }, now), FolderConflictError);
    const b = createFolder(db, { parentId: null, name: "B" }, now);
    assert.throws(() => renameFolder(db, b.id, "A", now), FolderConflictError);
    const sub = createFolder(db, { parentId: a.id, name: "B" }, now);
    assert.throws(() => moveFolder(db, sub.id, null, now), FolderConflictError);
    assert.equal(renameFolder(db, b.id, "B", now).name, "B");
  });

  it("refuses a move that creates a cycle", () => {
    const a = createFolder(db, { parentId: null, name: "A" }, now);
    const b = createFolder(db, { parentId: a.id, name: "B" }, now);
    const c = createFolder(db, { parentId: b.id, name: "C" }, now);
    assert.throws(() => moveFolder(db, a.id, c.id, now), FolderCycleError);
    assert.throws(() => moveFolder(db, a.id, a.id, now), FolderCycleError);
    const moved = moveFolder(db, c.id, null, now);
    assert.equal(moved.parentId, null);
    assert.throws(() => moveFolder(db, "missing", null, now), NotFoundError);
  });

  it("detects descendants with isDescendant", () => {
    const folders = [
      { id: "a", parentId: null, name: "a", position: 0 },
      { id: "b", parentId: "a", name: "b", position: 0 },
      { id: "c", parentId: "b", name: "c", position: 0 },
    ];
    assert.equal(isDescendant(folders, "c", "a"), true);
    assert.equal(isDescendant(folders, "a", "c"), false);
    assert.equal(isDescendant(folders, "a", "a"), false);
  });

  it("refuses to delete a non-empty folder, then lifts content with force", () => {
    const root = createFolder(db, { parentId: null, name: "Root" }, now);
    const p = createFolder(db, { parentId: root.id, name: "P" }, now);
    const sub = createFolder(db, { parentId: p.id, name: "Sub" }, now);
    addTrack(root.id, "r0");
    addTrack(p.id, "p0");
    addTrack(p.id, "p1");
    assert.throws(() => deleteFolder(db, p.id, { force: false }), FolderNotEmptyError);
    deleteFolder(db, p.id, { force: true });
    assert.deepEqual(positions(root.id), ["r0:0", "p0:1", "p1:2"]);
    const folders = listFolders(db);
    assert.deepEqual(
      folders.map((f) => [f.name, f.parentId, f.position]),
      [
        ["Root", null, 0],
        ["Sub", root.id, 0],
      ],
    );
    assert.equal(folders.find((f) => f.id === sub.id)?.parentId, root.id);
  });

  it("refuses a sub-folder only folder without force and deletes an empty one", () => {
    const a = createFolder(db, { parentId: null, name: "A" }, now);
    createFolder(db, { parentId: a.id, name: "B" }, now);
    assert.throws(() => deleteFolder(db, a.id, { force: false }), FolderNotEmptyError);
    const e = createFolder(db, { parentId: null, name: "E" }, now);
    deleteFolder(db, e.id, { force: false });
    assert.equal(
      listFolders(db).some((f) => f.id === e.id),
      false,
    );
    assert.throws(() => deleteFolder(db, "missing", { force: false }), NotFoundError);
  });

  it("rolls back a forced delete on a name conflict", () => {
    const root = createFolder(db, { parentId: null, name: "Root" }, now);
    createFolder(db, { parentId: root.id, name: "X" }, now);
    const p = createFolder(db, { parentId: root.id, name: "P" }, now);
    createFolder(db, { parentId: p.id, name: "X" }, now);
    addTrack(p.id, "p0");
    assert.throws(() => deleteFolder(db, p.id, { force: true }), FolderConflictError);
    assert.equal(listFolders(db).length, 4);
    assert.deepEqual(positions(p.id), ["p0:0"]);
  });

  it("detects root-level conflicts on a forced delete", () => {
    const a = createFolder(db, { parentId: null, name: "A" }, now);
    const p = createFolder(db, { parentId: null, name: "P" }, now);
    const q = createFolder(db, { parentId: p.id, name: "A" }, now);
    assert.throws(() => deleteFolder(db, p.id, { force: true }), FolderConflictError);
    assert.equal(listFolders(db).length, 3);
    assert.equal(getParent(q.id), p.id);
    assert.ok(a);
  });
});

function getParent(id: string): string | null {
  return listFolders(db).find((f) => f.id === id)?.parentId ?? null;
}

describe("tracks", () => {
  it("inserts with increasing positions and reads back", () => {
    const f = createFolder(db, { parentId: null, name: "F" }, now);
    const a = addTrack(f.id, "a");
    const b = addTrack(f.id, "b");
    const r = addTrack(null, "root");
    assert.equal(a.position, 0);
    assert.equal(b.position, 1);
    assert.equal(r.position, 0);
    assert.equal(getTrack(db, a.id)?.title, "a");
    assert.equal(getTrack(db, "missing"), null);
    assert.equal(findTrackBySha(db, b.sha256)?.id, b.id);
    assert.equal(findTrackBySha(db, "nope"), null);
  });

  it("lists only ready tracks but getTrack returns failed ones", () => {
    const ok = addTrack(null, "ok");
    const bad = addTrack(null, "bad", "failed");
    assert.deepEqual(
      listTracks(db).map((t) => t.id),
      [ok.id],
    );
    assert.equal(getTrack(db, bad.id)?.status, "failed");
  });

  it("rejects a second track with the same sha256", () => {
    const first = addTrack(null, "a");
    assert.throws(() =>
      insertTrack(
        db,
        {
          id: crypto.randomUUID(),
          folderId: null,
          title: "dup",
          artist: "",
          album: "",
          durationMs: null,
          format: "mp3",
          sizeBytes: 1,
          sha256: first.sha256,
          coverExt: null,
          status: "ready",
        },
        now,
      ),
    );
  });

  it("updates metadata and throws NotFoundError for unknown ids", () => {
    const t = addTrack(null, "a");
    const later = new Date("2026-02-01T00:00:00.000Z");
    const u = updateTrack(db, t.id, { title: "z", coverExt: "jpg" }, later);
    assert.equal(u.title, "z");
    assert.equal(u.coverExt, "jpg");
    assert.equal(u.updatedAt.toISOString(), later.toISOString());
    assert.equal(u.createdAt.toISOString(), now.toISOString());
    assert.throws(() => updateTrack(db, "missing", { title: "x" }, now), NotFoundError);
  });

  it("moves a track and renumbers both folders from 0", () => {
    const f1 = createFolder(db, { parentId: null, name: "F1" }, now);
    const f2 = createFolder(db, { parentId: null, name: "F2" }, now);
    const a = addTrack(f1.id, "a");
    addTrack(f1.id, "b");
    addTrack(f1.id, "c");
    addTrack(f2.id, "x");
    addTrack(f2.id, "y");
    moveTrack(db, a.id, f2.id, 1, now);
    assert.deepEqual(positions(f1.id), ["b:0", "c:1"]);
    assert.deepEqual(positions(f2.id), ["x:0", "a:1", "y:2"]);
    moveTrack(db, a.id, null, undefined, now);
    assert.deepEqual(positions(f2.id), ["x:0", "y:1"]);
    assert.deepEqual(positions(null), ["a:0"]);
    assert.throws(() => moveTrack(db, "missing", null, undefined, now), NotFoundError);
    assert.throws(() => moveTrack(db, a.id, "no-folder", undefined, now), NotFoundError);
  });

  it("reorders within the same folder", () => {
    const f = createFolder(db, { parentId: null, name: "F" }, now);
    addTrack(f.id, "a");
    addTrack(f.id, "b");
    const c = addTrack(f.id, "c");
    moveTrack(db, c.id, f.id, 0, now);
    assert.deepEqual(positions(f.id), ["c:0", "a:1", "b:2"]);
  });

  it("deletes a track, cascades favorites and renumbers", () => {
    const f = createFolder(db, { parentId: null, name: "F" }, now);
    const a = addTrack(f.id, "a");
    addTrack(f.id, "b");
    db.prepare(
      "INSERT INTO users (id, issuer, subject, groups, created_at, last_seen_at) VALUES ('u', 'i', 's', '[]', ?, ?)",
    ).run(now.toISOString(), now.toISOString());
    db.prepare("INSERT INTO favorites (user_id, track_id, created_at) VALUES ('u', ?, ?)").run(
      a.id,
      now.toISOString(),
    );
    deleteTrack(db, a.id);
    assert.deepEqual(positions(f.id), ["b:0"]);
    const count = db.prepare("SELECT COUNT(*) AS n FROM favorites").get() as { n: number };
    assert.equal(count.n, 0);
  });
});

describe("transactions", () => {
  it("rolls back a plain folder delete when renumbering fails", () => {
    const a = createFolder(db, { parentId: null, name: "A" }, now);
    createFolder(db, { parentId: null, name: "B" }, now);
    createFolder(db, { parentId: null, name: "C" }, now);
    db.exec("CREATE TRIGGER boom BEFORE UPDATE ON folders BEGIN SELECT RAISE(ABORT, 'boom'); END");
    assert.throws(() => deleteFolder(db, a.id, { force: false }), /boom/);
    db.exec("DROP TRIGGER boom");
    assert.deepEqual(
      listFolders(db).map((f) => [f.name, f.position]),
      [
        ["A", 0],
        ["B", 1],
        ["C", 2],
      ],
    );
  });

  it("rolls back a track move when a write fails midway", () => {
    const f1 = createFolder(db, { parentId: null, name: "F1" }, now);
    const f2 = createFolder(db, { parentId: null, name: "F2" }, now);
    const a = addTrack(f1.id, "a");
    addTrack(f1.id, "b");
    addTrack(f2.id, "x");
    db.exec(
      "CREATE TRIGGER boom BEFORE UPDATE OF position ON tracks WHEN NEW.title = 'b' BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    assert.throws(() => moveTrack(db, a.id, f2.id, 0, now), /boom/);
    db.exec("DROP TRIGGER boom");
    assert.deepEqual(positions(f1.id), ["a:0", "b:1"]);
    assert.deepEqual(positions(f2.id), ["x:0"]);
    assert.equal(getTrack(db, a.id)?.folderId, f1.id);
  });

  it("lifts children into the root on a forced delete and keeps 0..n-1", () => {
    const p = createFolder(db, { parentId: null, name: "P" }, now);
    createFolder(db, { parentId: p.id, name: "K1" }, now);
    createFolder(db, { parentId: p.id, name: "K2" }, now);
    createFolder(db, { parentId: null, name: "Z" }, now);
    addTrack(null, "r0");
    addTrack(p.id, "p0");
    deleteFolder(db, p.id, { force: true });
    renumber(db, null);
    assert.deepEqual(positions(null), ["r0:0", "p0:1"]);
    assert.deepEqual(
      listFolders(db).map((f) => [f.name, f.parentId, f.position]),
      [
        ["Z", null, 0],
        ["K1", null, 1],
        ["K2", null, 2],
      ],
    );
  });
});
