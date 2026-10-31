import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { imageBytes, writeMp3, writeWav } from "./fixtures.ts";
import { createTestApp } from "./helpers.ts";

let t: ReturnType<typeof createTestApp>;
let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "fulfil-"));
});
afterEach(() => {
  t?.cleanup();
  rmSync(scratch, { recursive: true, force: true });
});

const COVER_URL = "https://cdn-images.dzcdn.net/images/cover/abc/500x500.jpg";
const REQUESTED_COVER = imageBytes("png", 80);

const imageResponse = () =>
  new Response(new Uint8Array(REQUESTED_COVER), {
    status: 200,
    headers: { "content-type": "image/png" },
  });

/** An MP3 whose ID3v2.3 tag carries a PNG picture and a title. */
function mp3WithCover(file: string) {
  const frame = (id: string, body: Buffer) => {
    const head = Buffer.alloc(10);
    head.write(id, 0, "latin1");
    head.writeUInt32BE(body.length, 4);
    return Buffer.concat([head, body]);
  };
  const apic = frame(
    "APIC",
    Buffer.concat([
      Buffer.from([0]),
      Buffer.from("image/png\0", "latin1"),
      Buffer.from([3, 0]),
      imageBytes("png", 80),
    ]),
  );
  const tit2 = frame("TIT2", Buffer.concat([Buffer.from([0]), Buffer.from("Tag title", "latin1")]));
  const tags = Buffer.concat([tit2, apic]);
  const size = Buffer.from([
    (tags.length >> 21) & 0x7f,
    (tags.length >> 14) & 0x7f,
    (tags.length >> 7) & 0x7f,
    tags.length & 0x7f,
  ]);
  const header = Buffer.concat([Buffer.from("ID3", "latin1"), Buffer.from([3, 0, 0]), size]);
  const audio = Buffer.alloc(417);
  audio.set([0xff, 0xfb, 0x90, 0x00], 0);
  writeFileSync(file, Buffer.concat([header, tags, ...Array.from({ length: 8 }, () => audio)]));
}

function addRequest(
  over: Partial<{
    id: string;
    title: string;
    artist: string;
    album: string | null;
    coverUrl: string | null;
    status: string;
  }> = {},
) {
  const user = t.db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string };
  const r = {
    id: "r1",
    title: "Wanted",
    artist: "Band",
    album: "Disc",
    coverUrl: COVER_URL,
    status: "pending",
    ...over,
  };
  t.db
    .prepare(
      "INSERT INTO song_requests (id, user_id, title, artist, album, source, cover_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'deezer', ?, ?, 'c', 'c')",
    )
    .run(r.id, user.id, r.title, r.artist, r.album, r.coverUrl, r.status);
}

function send(cookie: string, file: Buffer, requestId?: string, folderId?: string) {
  const form = new FormData();
  if (requestId !== undefined) form.set("requestId", requestId);
  if (folderId !== undefined) form.set("folderId", folderId);
  form.set("file", new Blob([new Uint8Array(file)]), "file.bin");
  return t.app.request("/api/admin/imports", {
    method: "POST",
    body: form,
    headers: { cookie, "X-Requested-With": "player" },
  });
}

const wav = (seconds = 1) => {
  const f = path.join(scratch, `w${seconds}.wav`);
  writeWav(f, seconds);
  return readFileSync(f);
};
const mp3 = (cover = false) => {
  const f = path.join(scratch, cover ? "c.mp3" : "p.mp3");
  if (cover) mp3WithCover(f);
  else writeMp3(f);
  return readFileSync(f);
};

const request = (id = "r1") =>
  t.db.prepare("SELECT * FROM song_requests WHERE id = ?").get(id) as any;
const tracks = () => t.db.prepare("SELECT * FROM tracks").all() as any[];

describe("POST /api/admin/imports requestId", () => {
  it("answers 400 for an unknown, added or rejected request and keeps nothing", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    addRequest({ id: "added", status: "added" });
    addRequest({ id: "rej", status: "rejected" });
    for (const id of ["nope", "added", "rej"]) {
      const res = await send(cookie, wav(), id);
      assert.equal(res.status, 400, id);
    }
    assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM imports").get() as any).n, 0);
  });

  it("keeps request_id on the import row for a pending or accepted request", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    addRequest({ id: "p" });
    addRequest({ id: "a", status: "accepted" });
    for (const id of ["p", "a"]) {
      const res = await send(cookie, wav(id === "p" ? 1 : 2), id);
      assert.equal(res.status, 202);
    }
    await t.imports.idle();
    const rows = t.db.prepare("SELECT request_id FROM imports ORDER BY request_id").all() as any[];
    assert.deepEqual(
      rows.map((r) => r.request_id),
      ["a", "p"],
    );
  });

  it("ignores a requestId sent after the file", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    addRequest();
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(wav())]), "f.wav");
    form.set("requestId", "r1");
    const res = await t.app.request("/api/admin/imports", {
      method: "POST",
      body: form,
      headers: { cookie, "X-Requested-With": "player" },
    });
    assert.equal(res.status, 202);
    await t.imports.idle();
    assert.equal(request().status, "pending");
  });
});

describe("request fulfilment at import", () => {
  it("applies title, artist, album and cover, then marks the request added with an event", async () => {
    t = createTestApp({ metadata: { fetch: async () => imageResponse() } });
    const cookie = t.loginAs("admin");
    addRequest();
    assert.equal((await send(cookie, wav(), "r1")).status, 202);
    await t.imports.idle();
    const [track] = tracks();
    assert.equal(track.title, "Wanted");
    assert.equal(track.artist, "Band");
    assert.equal(track.album, "Disc");
    assert.equal(track.cover_ext, "png");
    const row = request();
    assert.equal(row.status, "added");
    assert.equal(row.track_id, track.id);
    assert.equal(row.updated_at, "2026-10-26T12:00:00.000Z");
    const events = t.db
      .prepare("SELECT track_id, detail FROM admin_events WHERE action = 'request_fulfilled'")
      .all() as any[];
    assert.equal(events.length, 1);
    assert.deepEqual(JSON.parse(events[0].detail), { requestId: "r1", trackId: track.id });
  });

  it("applies only non-empty fields, keeping the tags for the others", async () => {
    t = createTestApp({ metadata: { fetch: async () => imageResponse() } });
    const cookie = t.loginAs("admin");
    addRequest({ artist: "", album: null, coverUrl: null });
    await send(cookie, mp3(true), "r1");
    await t.imports.idle();
    const [track] = tracks();
    assert.equal(track.title, "Wanted");
    assert.equal(track.artist, "");
    assert.equal(track.album, "");
    assert.equal(request().status, "added");
  });

  it("downloads the cover only when the file has no embedded one", async () => {
    let calls = 0;
    t = createTestApp({
      metadata: {
        fetch: async () => {
          calls += 1;
          return imageResponse();
        },
      },
    });
    const cookie = t.loginAs("admin");
    addRequest();
    await send(cookie, mp3(true), "r1");
    await t.imports.idle();
    assert.equal(calls, 0);
    const [track] = tracks();
    assert.equal(track.title, "Wanted");
    assert.equal(track.cover_ext, "png");
    assert.deepEqual(readFileSync(t.storage.coverPath(track.id, "png")), imageBytes("png", 80));
  });

  it("logs a failed cover download and still fulfils the request", async () => {
    t = createTestApp({
      metadata: {
        fetch: async () => {
          throw new Error("boom");
        },
      },
    });
    const cookie = t.loginAs("admin");
    addRequest();
    await send(cookie, wav(), "r1");
    await t.imports.idle();
    const [track] = tracks();
    assert.equal(track.cover_ext, null);
    assert.equal(request().status, "added");
    const logged = t.log.filter((entry) => entry.event === "request.cover_failed");
    assert.equal(logged.length, 1);
    assert.equal(logged[0]?.data?.["requestId"], "r1");
  });

  it("refuses a cover URL on a host outside the allow list, without fetching", async () => {
    let calls = 0;
    t = createTestApp({
      metadata: {
        fetch: async () => {
          calls += 1;
          return imageResponse();
        },
      },
    });
    const cookie = t.loginAs("admin");
    addRequest({ coverUrl: "https://evil.example/c.png" });
    await send(cookie, wav(), "r1");
    await t.imports.idle();
    assert.equal(calls, 0);
    assert.equal(request().status, "added");
    assert.equal(t.log.filter((e) => e.event === "request.cover_failed").length, 1);
  });

  it("marks the request added with the existing track on a duplicate", async () => {
    t = createTestApp({ metadata: { fetch: async () => imageResponse() } });
    const cookie = t.loginAs("admin");
    await send(cookie, wav(), undefined);
    await t.imports.idle();
    const [existing] = tracks();
    addRequest();
    await send(cookie, wav(), "r1");
    await t.imports.idle();
    assert.equal(tracks().length, 1);
    const row = request();
    assert.equal(row.status, "added");
    assert.equal(row.track_id, existing.id);
    assert.equal(
      (
        t.db
          .prepare("SELECT COUNT(*) AS n FROM admin_events WHERE action = 'request_fulfilled'")
          .get() as any
      ).n,
      1,
    );
    // The existing track keeps its own title.
    assert.notEqual(existing.title, "Wanted");
  });

  it("leaves the request untouched when the import fails", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    addRequest({ status: "accepted" });
    await send(cookie, Buffer.from("not audio at all"), "r1");
    await t.imports.idle();
    const row = request();
    assert.equal(row.status, "accepted");
    assert.equal(row.track_id, null);
    assert.equal(row.updated_at, "c");
    assert.equal(tracks().length, 0);
    assert.equal(
      (
        t.db
          .prepare("SELECT COUNT(*) AS n FROM admin_events WHERE action = 'request_fulfilled'")
          .get() as any
      ).n,
      0,
    );
  });

  it("works through an mp3 without tags when a folder is given", async () => {
    t = createTestApp({ metadata: { fetch: async () => imageResponse() } });
    const cookie = t.loginAs("admin");
    t.db.prepare("INSERT INTO folders (id, name, created_at) VALUES ('f1', 'Rock', 'x')").run();
    addRequest();
    await send(cookie, mp3(), "r1", "f1");
    await t.imports.idle();
    const [track] = tracks();
    assert.equal(track.folder_id, "f1");
    assert.equal(track.title, "Wanted");
    assert.equal(track.cover_ext, "png");
  });
});
