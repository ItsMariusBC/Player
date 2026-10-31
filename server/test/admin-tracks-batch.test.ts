import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import NodeID3 from "node-id3";
import { getTrack } from "../src/catalog/tracks.ts";
import { createTestApp } from "./helpers.ts";
import { writeMp3, writeWav } from "./fixtures.ts";

let t: ReturnType<typeof createTestApp>;
let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "admin-batch-"));
});
afterEach(() => {
  t?.cleanup();
  rmSync(scratch, { recursive: true, force: true });
});

const CSRF = { "X-Requested-With": "player" };

function call(cookie: string, url: string, body?: unknown) {
  return t.app.request(url, {
    method: "POST",
    headers: { cookie, ...CSRF, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const batch = (cookie: string, body: unknown) => call(cookie, "/api/admin/tracks/batch", body);
const batchDelete = (cookie: string, body: unknown) =>
  call(cookie, "/api/admin/tracks/batch-delete", body);

async function importFixture(cookie: string, kind: "mp3" | "wav", seconds = 1): Promise<string> {
  const file = path.join(scratch, `${crypto.randomUUID()}.${kind}`);
  if (kind === "mp3") writeMp3(file);
  else writeWav(file, seconds);
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(readFileSync(file))]), `song.${kind}`);
  const res = await t.app.request("/api/admin/imports", {
    method: "POST",
    body: form,
    headers: { cookie, ...CSRF },
  });
  const { importId } = (await res.json()) as { importId: string };
  await t.imports.idle();
  const row = t.db.prepare("SELECT track_id FROM imports WHERE id = ?").get(importId) as {
    track_id: string;
  };
  return row.track_id;
}

async function createFolder(cookie: string, name: string) {
  const res = await call(cookie, "/api/admin/folders", { name, parentId: null });
  return ((await res.json()) as { folder: { id: string } }).folder.id;
}

const events = (action: string) =>
  (
    t.db.prepare("SELECT detail FROM admin_events WHERE action = ? ORDER BY rowid").all(action) as {
      detail: string;
    }[]
  ).map((r) => JSON.parse(r.detail) as Record<string, unknown>);

const allActions = () =>
  (t.db.prepare("SELECT action FROM admin_events").all() as { action: string }[]).map(
    (r) => r.action,
  );

describe("admin tracks: batch validation", () => {
  it("rejects malformed bodies with 400", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const id = await importFixture(cookie, "wav");
    const patch = { artist: "A" };
    const bad: unknown[] = [
      undefined,
      {},
      { patch },
      { ids: [id] },
      { ids: [], patch },
      { ids: Array.from({ length: 201 }, (_, i) => `id-${i}`), patch },
      { ids: [id, id], patch },
      { ids: [id, 3], patch },
      { ids: [""], patch },
      { ids: id, patch },
      { ids: [id], patch: {} },
      { ids: [id], patch: { title: "X" } },
      { ids: [id], patch: { artist: "A", position: 0 } },
      { ids: [id], patch: { artist: "" } },
      { ids: [id], patch: { artist: "x".repeat(201) } },
      { ids: [id], patch: { album: "x".repeat(201) } },
      { ids: [id], patch: { album: 3 } },
      { ids: [id], patch: { folderId: "" } },
      { ids: [id], patch: { folderId: "nope" } },
      { ids: [id], patch, extra: true },
      { ids: [id], patch: [] },
    ];
    for (const body of bad) {
      const res = await batch(cookie, body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal((await batchDelete(cookie, { ids: [] })).status, 400);
    assert.equal(
      (await batchDelete(cookie, { ids: Array.from({ length: 201 }, (_, i) => `i${i}`) })).status,
      400,
    );
    assert.equal((await batchDelete(cookie, { ids: [id, id] })).status, 400);
    assert.equal((await batchDelete(cookie, { ids: [id], patch })).status, 400);
    assert.equal(getTrack(t.db, id) !== null, true);
    assert.deepEqual(
      allActions().filter((a) => a.startsWith("track_")),
      [],
    );
  });

  it("accepts exactly 200 ids", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const ids = Array.from({ length: 200 }, (_, i) => `ghost-${i}`);
    const res = await batch(cookie, { ids, patch: { album: "" } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { updated: unknown[]; missing: string[] };
    assert.equal(body.updated.length, 0);
    assert.equal(body.missing.length, 200);
  });

  it("refuses the user role", async () => {
    t = createTestApp();
    const admin = t.loginAs("admin");
    const id = await importFixture(admin, "wav");
    const cookie = t.loginAs("user");
    assert.equal((await batch(cookie, { ids: [id], patch: { artist: "X" } })).status, 403);
    assert.equal((await batchDelete(cookie, { ids: [id] })).status, 403);
    assert.equal(getTrack(t.db, id)!.artist !== "X", true);
  });
});

describe("admin tracks: batch update", () => {
  it("updates tracks, reports missing ids and surfaces tagsWritten per track", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const mp3 = await importFixture(cookie, "mp3");
    const wav = await importFixture(cookie, "wav");
    const folder = await createFolder(cookie, "Rock");
    const wav2 = await importFixture(cookie, "wav", 2);
    t.db.prepare("UPDATE tracks SET status = 'failed' WHERE id = ?").run(wav2);
    const res = await batch(cookie, {
      ids: [mp3, "unknown", wav, wav2],
      patch: { artist: "Groupe", album: "Disque", folderId: folder },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      updated: { id: string; tagsWritten: boolean }[];
      missing: string[];
      failed: string[];
    };
    assert.deepEqual(body.updated, [
      { id: mp3, tagsWritten: true },
      { id: wav, tagsWritten: false },
    ]);
    assert.deepEqual(body.missing, ["unknown", wav2]);
    assert.deepEqual(body.failed, []);
    for (const id of [mp3, wav]) {
      const track = getTrack(t.db, id)!;
      assert.equal(track.artist, "Groupe");
      assert.equal(track.album, "Disque");
      assert.equal(track.folderId, folder);
    }
    assert.equal(getTrack(t.db, wav2)!.artist === "Groupe", false);
    const tags = NodeID3.read(path.join(t.tempDir, "media", mp3, "original.mp3"));
    assert.equal(tags.artist, "Groupe");
  });

  it("moves tracks back to the inbox with a null folderId and clears an album", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const id = await importFixture(cookie, "wav");
    const folder = await createFolder(cookie, "Rock");
    await batch(cookie, { ids: [id], patch: { folderId: folder } });
    assert.equal(getTrack(t.db, id)!.folderId, folder);
    const res = await batch(cookie, { ids: [id], patch: { folderId: null, album: "" } });
    assert.equal(res.status, 200);
    assert.equal(getTrack(t.db, id)!.folderId, null);
    assert.equal(getTrack(t.db, id)!.album, "");
  });

  it("records one event per batch, with the count and keys only", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const a = await importFixture(cookie, "wav");
    const b = await importFixture(cookie, "wav", 2);
    await batch(cookie, { ids: [a, b, "unknown"], patch: { artist: "Z", album: "Y" } });
    assert.deepEqual(events("track_batch_update"), [{ count: 2, keys: ["artist", "album"] }]);
    assert.equal(allActions().filter((x) => x === "track_update").length, 0);
  });

  it("lists a track whose update fails and carries on with the others", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const a = await importFixture(cookie, "wav");
    const b = await importFixture(cookie, "wav", 2);
    t.db.exec(
      `CREATE TRIGGER fail_one BEFORE UPDATE ON tracks WHEN NEW.id = '${a}' BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );
    const res = await batch(cookie, { ids: [a, b], patch: { artist: "Z" } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      updated: { id: string }[];
      failed: string[];
    };
    assert.deepEqual(body.failed, [a]);
    assert.deepEqual(
      body.updated.map((u) => u.id),
      [b],
    );
    assert.equal(getTrack(t.db, b)!.artist, "Z");
    assert.deepEqual(events("track_batch_update"), [{ count: 1, keys: ["artist"] }]);
  });
});

describe("admin tracks: batch delete", () => {
  it("removes the rows and the media, reports missing ids and records one event", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const a = await importFixture(cookie, "wav");
    const b = await importFixture(cookie, "wav", 2);
    const keep = await importFixture(cookie, "wav", 3);
    assert.equal((await t.app.request(`/api/media/${a}`, { headers: { cookie } })).status, 200);
    const res = await batchDelete(cookie, { ids: [a, "unknown", b] });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { deleted: [a, b], missing: ["unknown"], failed: [] });
    for (const id of [a, b]) {
      assert.equal(getTrack(t.db, id), null);
      const media = await t.app.request(`/api/media/${id}`, { headers: { cookie } });
      assert.equal(media.status, 404);
    }
    assert.notEqual(getTrack(t.db, keep), null);
    assert.deepEqual(events("track_batch_delete"), [{ count: 2 }]);
    assert.equal(allActions().filter((x) => x === "track_delete").length, 0);
  });
});
