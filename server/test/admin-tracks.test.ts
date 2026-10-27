import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import NodeID3 from "node-id3";
import { getTrack } from "../src/catalog/tracks.ts";
import { createTestApp } from "./helpers.ts";
import { imageBytes, writeMp3, writeWav } from "./fixtures.ts";

let t: ReturnType<typeof createTestApp>;
let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "admin-tracks-"));
});
afterEach(() => {
  t?.cleanup();
  rmSync(scratch, { recursive: true, force: true });
});

const CSRF = { "X-Requested-With": "player" };

function call(cookie: string, method: string, url: string, body?: unknown) {
  return t.app.request(url, {
    method,
    headers: {
      cookie,
      ...CSRF,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

/** Imports a fixture through the real pipeline and returns the track id. */
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
  const res = await call(cookie, "POST", "/api/admin/folders", { name, parentId: null });
  return ((await res.json()) as { folder: { id: string } }).folder.id;
}

function uploadCover(cookie: string, trackId: string, data: Buffer | null, field = "file") {
  const form = new FormData();
  if (data) form.set(field, new Blob([new Uint8Array(data)]), "cover.bin");
  else form.set("other", "x");
  return t.app.request(`/api/admin/tracks/${trackId}/cover`, {
    method: "POST",
    body: form,
    headers: { cookie, ...CSRF },
  });
}

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const original = (id: string, ext: string) => path.join(t.tempDir, "media", id, `original.${ext}`);
const actions = () =>
  (t.db.prepare("SELECT action FROM admin_events ORDER BY rowid").all() as { action: string }[])
    .map((r) => r.action)
    .filter((a) => a !== "import" && !a.startsWith("folder_"));

describe("admin tracks: metadata", () => {
  it("rewrites MP3 tags, recomputes sha256 and size, bumps updatedAt", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const id = await importFixture(cookie, "mp3");
    const before = getTrack(t.db, id)!;
    t.advance(60_000);
    const res = await call(cookie, "PATCH", `/api/admin/tracks/${id}`, {
      title: "Nouveau",
      artist: "Quelqu'un",
      album: "Disque",
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { track: any; tagsWritten: boolean };
    assert.equal(body.tagsWritten, true);
    assert.equal(body.track.title, "Nouveau");
    assert.equal(body.track.artist, "Quelqu'un");
    assert.equal(body.track.album, "Disque");
    assert.equal(body.track.updatedAt, t.now().toISOString());
    const after = getTrack(t.db, id)!;
    assert.notEqual(after.sha256, before.sha256);
    assert.equal(after.sha256, sha(original(id, "mp3")));
    assert.equal(after.sizeBytes, statSync(original(id, "mp3")).size);
    assert.equal(NodeID3.read(original(id, "mp3")).title, "Nouveau");
    // No temporary file is left next to the original.
    assert.deepEqual(readdirSync(path.join(t.tempDir, "media", id)), ["original.mp3"]);
  });

  it("updates WAV metadata in the database only", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const id = await importFixture(cookie, "wav");
    const before = getTrack(t.db, id)!;
    const bytes = readFileSync(original(id, "wav"));
    const res = await call(cookie, "PATCH", `/api/admin/tracks/${id}`, { title: "Wave" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { track: any; tagsWritten: boolean };
    assert.equal(body.tagsWritten, false);
    assert.equal(body.track.title, "Wave");
    assert.equal(getTrack(t.db, id)!.sha256, before.sha256);
    assert.deepEqual(readFileSync(original(id, "wav")), bytes);
  });

  it("moves a track to a folder and a position", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const folder = await createFolder(cookie, "F");
    const a = await importFixture(cookie, "wav", 1);
    const b = await importFixture(cookie, "wav", 2);
    assert.equal(
      (await call(cookie, "PATCH", `/api/admin/tracks/${a}`, { folderId: folder })).status,
      200,
    );
    const res = await call(cookie, "PATCH", `/api/admin/tracks/${b}`, {
      folderId: folder,
      position: 0,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { track: any; tagsWritten: boolean };
    assert.equal(body.tagsWritten, false);
    assert.equal(body.track.folderId, folder);
    assert.equal(body.track.position, 0);
    assert.equal(getTrack(t.db, a)!.position, 1);
    const back = await call(cookie, "PATCH", `/api/admin/tracks/${a}`, { folderId: null });
    assert.equal(((await back.json()) as any).track.folderId, null);
    assert.equal(getTrack(t.db, b)!.position, 0);
  });

  it("rejects invalid patches with 400 bad_request", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const id = await importFixture(cookie, "wav");
    const before = getTrack(t.db, id)!;
    const bad: unknown[] = [
      { folderId: "missing-folder" },
      { position: -1 },
      { position: 1.5 },
      { position: "0" },
      { title: "" },
      { title: "   " },
      { title: "x".repeat(201) },
      { title: 3 },
      { artist: null },
      { album: "x".repeat(201) },
      { folderId: 4 },
      { genre: "Jazz" },
      {},
      [],
      "title",
    ];
    for (const patch of bad) {
      const res = await call(cookie, "PATCH", `/api/admin/tracks/${id}`, patch);
      assert.equal(res.status, 400, JSON.stringify(patch));
      assert.equal(await errorCode(res), "bad_request");
    }
    assert.deepEqual(getTrack(t.db, id), before);
    assert.deepEqual(actions(), []);
    const missing = await call(cookie, "PATCH", "/api/admin/tracks/nope", { title: "X" });
    assert.equal(missing.status, 404);
  });
});

describe("admin tracks: delete", () => {
  it("deletes the row, favorites and media, then the media route answers 404", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const id = await importFixture(cookie, "wav");
    assert.equal((await t.app.request(`/api/media/${id}`, { headers: { cookie } })).status, 200);
    const user = t.db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string };
    t.db
      .prepare("INSERT INTO favorites (user_id, track_id, created_at) VALUES (?, ?, ?)")
      .run(user.id, id, t.now().toISOString());
    const res = await call(cookie, "DELETE", `/api/admin/tracks/${id}`);
    assert.equal(res.status, 204);
    assert.equal(getTrack(t.db, id), null);
    assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM favorites").get() as any).n, 0);
    assert.equal(existsSync(path.join(t.tempDir, "media", id)), false);
    assert.equal((await t.app.request(`/api/media/${id}`, { headers: { cookie } })).status, 404);
    assert.equal((await call(cookie, "DELETE", `/api/admin/tracks/${id}`)).status, 404);
  });
});

describe("admin tracks: cover", () => {
  it("replaces the cover, removes the previous file and bumps updatedAt", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const id = await importFixture(cookie, "wav");
    t.advance(1000);
    const png = imageBytes("png");
    const res = await uploadCover(cookie, id, png);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { hasCover: true });
    const cover = await t.app.request(`/api/media/${id}/cover`, { headers: { cookie } });
    assert.equal(cover.status, 200);
    assert.equal(cover.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await cover.arrayBuffer()), png);
    assert.equal(getTrack(t.db, id)!.updatedAt.toISOString(), t.now().toISOString());

    t.advance(1000);
    const webp = imageBytes("webp");
    assert.equal((await uploadCover(cookie, id, webp)).status, 200);
    assert.deepEqual(readdirSync(path.join(t.tempDir, "media", id)).sort(), [
      "cover.webp",
      "original.wav",
    ]);
    const catalog = (await (
      await t.app.request("/api/catalog", { headers: { cookie } })
    ).json()) as { tracks: any[] };
    assert.equal(catalog.tracks[0].hasCover, true);
    assert.equal(catalog.tracks[0].updatedAt, t.now().toISOString());

    assert.equal((await uploadCover(cookie, id, imageBytes("jpg"))).status, 200);
    assert.equal(getTrack(t.db, id)!.coverExt, "jpg");
  });

  it("rejects bad signatures, missing files and oversized images", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const id = await importFixture(cookie, "wav");
    const bad = await uploadCover(cookie, id, Buffer.from("GIF89a not accepted here"));
    assert.equal(bad.status, 400);
    assert.equal(await errorCode(bad), "bad_request");
    const none = await uploadCover(cookie, id, null);
    assert.equal(none.status, 400);
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
    big.set([0xff, 0xd8, 0xff], 0);
    const large = await uploadCover(cookie, id, big);
    assert.equal(large.status, 413);
    assert.equal(await errorCode(large), "too_large");
    const exact = Buffer.alloc(5 * 1024 * 1024, 0);
    exact.set([0xff, 0xd8, 0xff], 0);
    assert.equal((await uploadCover(cookie, id, exact)).status, 200);
    assert.deepEqual(readdirSync(path.join(t.tempDir, "media", id)).sort(), [
      "cover.jpg",
      "original.wav",
    ]);
    assert.equal((await uploadCover(cookie, "nope", imageBytes("png"))).status, 404);
  });

  it("does not leave temporary files after a refused upload", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const id = await importFixture(cookie, "wav");
    await uploadCover(cookie, id, Buffer.from("nope"));
    assert.deepEqual(readdirSync(path.join(t.tempDir, "media", id)), ["original.wav"]);
    assert.equal(getTrack(t.db, id)!.coverExt, null);
  });
});

describe("admin tracks: audit and access", () => {
  it("records one admin event per mutation", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const id = await importFixture(cookie, "mp3");
    await call(cookie, "PATCH", `/api/admin/tracks/${id}`, { title: "A" });
    await uploadCover(cookie, id, imageBytes("png"));
    await call(cookie, "DELETE", `/api/admin/tracks/${id}`);
    assert.deepEqual(actions(), ["track_update", "cover_replace", "track_delete"]);
    const update = t.db
      .prepare("SELECT track_id, detail FROM admin_events WHERE action = 'track_update'")
      .get() as { track_id: string; detail: string };
    assert.equal(update.track_id, id);
    assert.deepEqual(JSON.parse(update.detail), { title: "A", tagsWritten: true });
  });

  it("refuses the user role on every admin track route", async () => {
    t = createTestApp();
    const admin = t.loginAs("admin");
    const id = await importFixture(admin, "wav");
    const cookie = t.loginAs("user");
    assert.equal(
      (await call(cookie, "PATCH", `/api/admin/tracks/${id}`, { title: "X" })).status,
      403,
    );
    assert.equal((await call(cookie, "DELETE", `/api/admin/tracks/${id}`)).status, 403);
    assert.equal((await uploadCover(cookie, id, imageBytes("png"))).status, 403);
    assert.equal(getTrack(t.db, id)!.title !== "X", true);
    assert.deepEqual(actions(), []);
  });
});
