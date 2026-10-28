import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { getTrack, insertTrack } from "../src/catalog/tracks.ts";
import { ingestFile } from "../src/media/ingest.ts";
import { writeWav } from "./fixtures.ts";
import { createTestApp } from "./helpers.ts";

let t: ReturnType<typeof createTestApp>;
afterEach(() => t?.cleanup());

const H = { "X-Requested-With": "player" };

type Format = "wav" | "flac" | "mp3";

/** A ready track with an original file on disk. */
function seed(
  id: string,
  extra: { format?: Format; status?: "ready" | "failed"; attempted?: boolean } = {},
) {
  const format = extra.format ?? "wav";
  insertTrack(
    t.db,
    {
      id,
      folderId: null,
      title: id,
      artist: "",
      album: "",
      durationMs: 1000,
      format,
      sizeBytes: 1,
      sha256: `sha-${id}`,
      coverExt: null,
      status: extra.status ?? "ready",
    },
    t.now(),
  );
  if (extra.attempted) {
    t.db
      .prepare("UPDATE tracks SET aac_attempted_at = ? WHERE id = ?")
      .run(t.now().toISOString(), id);
  }
  mkdirSync(t.storage.mediaPath(id), { recursive: true });
  writeFileSync(t.storage.originalPath(id, format), "original");
}

const fakeFlac = async (_src: string, dest: string) => {
  await writeFile(dest, Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(20)]));
  return true;
};
const fakeAac = async (_src: string, dest: string) => {
  await writeFile(dest, "aac-bytes");
  return true;
};

const get = (cookie: string) =>
  t.app.request("/api/admin/media/optimize", { headers: { cookie, ...H } });
const post = (cookie: string) =>
  t.app.request("/api/admin/media/optimize", { method: "POST", headers: { cookie, ...H } });
const events = () =>
  t.db.prepare("SELECT detail FROM admin_events WHERE action = 'media_optimize'").all() as {
    detail: string;
  }[];

describe("admin media optimize routes", () => {
  it("forbids the user role on both routes", async () => {
    t = createTestApp();
    const cookie = t.loginAs("user");
    assert.equal((await get(cookie)).status, 403);
    assert.equal((await post(cookie)).status, 403);
  });

  it("reports the counters, then starts a pass: 202, one event, a second call queues nothing", async () => {
    t = createTestApp({ convertWav: fakeFlac, encodeAac: fakeAac });
    const cookie = t.loginAs("admin");
    seed("a");
    seed("b", { format: "flac" });
    seed("done", { format: "flac", attempted: true });
    seed("broken", { status: "failed" });
    assert.deepEqual(await (await get(cookie)).json(), {
      total: 3,
      light: 0,
      failed: 1,
      pending: 2,
      wav: 1,
      running: false,
      available: true,
    });
    const res = await post(cookie);
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { queued: 2, running: true });
    const again = await post(cookie);
    assert.equal(again.status, 202);
    assert.deepEqual(await again.json(), { queued: 0, running: true });
    await t.imports.idle();
    assert.deepEqual(
      events().map((e) => JSON.parse(e.detail)),
      [{ queued: 2 }],
    );
    assert.deepEqual(await (await get(cookie)).json(), {
      total: 3,
      light: 2,
      failed: 1,
      pending: 0,
      wav: 0,
      running: false,
      available: true,
    });
  });

  it("answers 202 with nothing queued when there is nothing to do", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    seed("done", { format: "flac", attempted: true });
    const res = await post(cookie);
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { queued: 0, running: false });
    assert.equal(events().length, 0);
  });

  it("answers 409 ffmpeg_unavailable and queues nothing", async () => {
    t = createTestApp({ ffmpegAvailable: false });
    const cookie = t.loginAs("admin");
    seed("a");
    const res = await post(cookie);
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as any).error.code, "ffmpeg_unavailable");
    assert.equal(events().length, 0);
    assert.equal((await (await get(cookie)).json()).running, false);
  });
});

describe("optimization pass", () => {
  it("converts a WAV: new file and row first, old file removed, then the variant", async () => {
    t = createTestApp({ convertWav: fakeFlac, encodeAac: fakeAac });
    const cookie = t.loginAs("admin");
    seed("a");
    await post(cookie);
    await t.imports.idle();
    const track = getTrack(t.db, "a")!;
    assert.equal(track.format, "flac");
    assert.equal(track.sizeBytes, 24);
    assert.equal(track.aacSizeBytes, 9);
    assert.ok(track.aacAttemptedAt);
    assert.ok(existsSync(t.storage.originalPath("a", "flac")));
    assert.ok(!existsSync(t.storage.originalPath("a", "wav")));
    assert.equal(await readFile(t.storage.variantPath("a"), "utf8"), "aac-bytes");
    assert.deepEqual(readdirSync(t.storage.mediaPath("a")).sort(), ["original.flac", "stream.m4a"]);
  });

  it("encodes the variant from the converted original", async () => {
    const sources: string[] = [];
    t = createTestApp({
      convertWav: fakeFlac,
      encodeAac: async (src, dest) => {
        sources.push(path.basename(src));
        return fakeAac(src, dest);
      },
    });
    seed("a");
    t.imports.startOptimize();
    await t.imports.idle();
    assert.deepEqual(sources, ["original.flac"]);
  });

  it("keeps a WAV whose conversion fails, still encodes it, and does not loop", async () => {
    let conversions = 0;
    t = createTestApp({
      convertWav: async () => {
        conversions += 1;
        return false;
      },
      encodeAac: fakeAac,
    });
    seed("a");
    t.imports.startOptimize();
    await t.imports.idle();
    assert.equal(conversions, 1);
    const track = getTrack(t.db, "a")!;
    assert.equal(track.format, "wav");
    assert.equal(track.aacSizeBytes, 9);
    assert.ok(existsSync(t.storage.originalPath("a", "wav")));
    assert.equal((await t.imports.optimizeStatus()).running, false);
  });

  it("rejects a conversion whose output is not a FLAC", async () => {
    t = createTestApp({
      convertWav: async (_src, dest) => {
        await writeFile(dest, "not a flac at all");
        return true;
      },
      encodeAac: fakeAac,
    });
    seed("a");
    t.imports.startOptimize();
    await t.imports.idle();
    assert.equal(getTrack(t.db, "a")!.format, "wav");
    assert.deepEqual(readdirSync(t.storage.mediaPath("a")).sort(), ["original.wav", "stream.m4a"]);
  });

  it("records a failed encoding as failed, without a variant or scratch file", async () => {
    let calls = 0;
    t = createTestApp({
      encodeAac: async (_src, dest) => {
        calls += 1;
        await writeFile(dest, "partial");
        return false;
      },
    });
    const cookie = t.loginAs("admin");
    seed("a", { format: "flac" });
    await post(cookie);
    await t.imports.idle();
    assert.equal(calls, 1);
    const track = getTrack(t.db, "a")!;
    assert.equal(track.aacSizeBytes, null);
    assert.ok(track.aacAttemptedAt);
    assert.deepEqual(readdirSync(t.storage.mediaPath("a")), ["original.flac"]);
    const body = (await (await get(cookie)).json()) as Record<string, unknown>;
    assert.equal(body["failed"], 1);
    assert.equal(body["pending"], 0);
    // A failed attempt is not retried by the next pass.
    assert.deepEqual(t.imports.startOptimize(), { queued: 0, running: false });
  });

  it("ignores a track deleted while the pass runs and carries on", async () => {
    t = createTestApp({
      encodeAac: async (src, dest) => {
        if (src.includes(`${path.sep}a${path.sep}`)) {
          t.db.prepare("DELETE FROM tracks WHERE id = 'b'").run();
        }
        return fakeAac(src, dest);
      },
    });
    seed("a", { format: "flac" });
    seed("b", { format: "flac" });
    seed("c", { format: "flac" });
    t.imports.startOptimize();
    await t.imports.idle();
    assert.equal(getTrack(t.db, "a")!.aacSizeBytes, 9);
    assert.equal(getTrack(t.db, "b"), null);
    assert.equal(getTrack(t.db, "c")!.aacSizeBytes, 9);
    assert.equal((await t.imports.optimizeStatus()).running, false);
  });

  it("does not touch updated_at", async () => {
    t = createTestApp({ convertWav: fakeFlac, encodeAac: fakeAac });
    seed("a");
    const before = getTrack(t.db, "a")!.updatedAt.toISOString();
    t.advance(60_000);
    t.imports.startOptimize();
    await t.imports.idle();
    assert.equal(getTrack(t.db, "a")!.updatedAt.toISOString(), before);
  });
});

describe("optimization after an import", () => {
  const wav = () => {
    const file = path.join(t.tempDir, "src.wav");
    writeWav(file, 1);
    return readFile(file);
  };
  async function upload(cookie: string) {
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(await wav())]), "song.wav");
    const res = await t.app.request("/api/admin/imports", {
      method: "POST",
      body: form,
      headers: { cookie, ...H },
    });
    assert.equal(res.status, 202);
  }

  it("starts by itself, converts the upload and prepares the variant, with no admin event", async () => {
    t = createTestApp({ convertWav: fakeFlac, encodeAac: fakeAac });
    const cookie = t.loginAs("admin");
    await upload(cookie);
    await t.imports.idle();
    const row = t.db.prepare("SELECT id FROM tracks").get() as { id: string };
    const track = getTrack(t.db, row.id)!;
    assert.equal(track.format, "flac");
    assert.equal(track.aacSizeBytes, 9);
    assert.equal(events().length, 0);
    assert.equal((await t.imports.optimizeStatus()).running, false);
  });

  it("does not start when ffmpeg is unavailable", async () => {
    t = createTestApp({ ffmpegAvailable: false, encodeAac: fakeAac });
    const cookie = t.loginAs("admin");
    await upload(cookie);
    await t.imports.idle();
    const row = t.db.prepare("SELECT id FROM tracks").get() as { id: string };
    assert.equal(getTrack(t.db, row.id)!.aacAttemptedAt, null);
  });
});

describe("ingestFile WAV conversion", () => {
  async function ingest(convertWav: (file: string, dest: string) => Promise<boolean>) {
    t = createTestApp();
    const file = path.join(t.storage.incomingDir("imp"), "upload.bin");
    writeWav(file, 1);
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
    const calls: string[] = [];
    const result = await ingestFile({
      db: t.db,
      storage: t.storage,
      importId: "imp",
      file,
      fallbackTitle: "Song",
      convertWav: async (f, d) => {
        calls.push(path.basename(d));
        return convertWav(f, d);
      },
      now: t.now(),
    });
    assert.equal(result.kind, "ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    return { track: result.track, sha, calls };
  }

  it("publishes the FLAC: format, size of the FLAC, sha256 of the WAV", async () => {
    const { track, sha, calls } = await ingest(fakeFlac);
    assert.deepEqual(calls, ["converted.flac"]);
    assert.equal(track.format, "flac");
    assert.equal(track.sizeBytes, 24);
    assert.equal(track.sha256, sha);
    assert.equal(track.durationMs, 1000);
    assert.ok(existsSync(t.storage.originalPath(track.id, "flac")));
    assert.ok(!existsSync(t.storage.originalPath(track.id, "wav")));
    assert.ok(!existsSync(path.join(t.storage.incomingDir("imp"), "converted.flac")));
  });

  it("publishes the WAV as it is when the conversion fails", async () => {
    const { track, sha } = await ingest(async () => false);
    assert.equal(track.format, "wav");
    assert.equal(track.sha256, sha);
    assert.ok(existsSync(t.storage.originalPath(track.id, "wav")));
  });

  it("publishes the WAV as it is when the converter throws", async () => {
    const { track } = await ingest(async () => {
      throw new Error("boom");
    });
    assert.equal(track.format, "wav");
  });
});
