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
  extra: {
    format?: Format;
    status?: "ready" | "failed";
    attempted?: boolean;
    /** A variant size: the track counts as having a light variant. */
    aacSize?: number;
    sizeBytes?: number;
  } = {},
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
      sizeBytes: extra.sizeBytes ?? 1000,
      sha256: `sha-${id}`,
      coverExt: null,
      status: extra.status ?? "ready",
    },
    t.now(),
  );
  if (extra.attempted) {
    t.db
      .prepare("UPDATE tracks SET aac_attempted_at = ?, aac_size_bytes = ? WHERE id = ?")
      .run(t.now().toISOString(), extra.aacSize ?? null, id);
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
    seed("done", { format: "flac", attempted: true, aacSize: 5 });
    seed("broken", { status: "failed" });
    assert.deepEqual(await (await get(cookie)).json(), {
      total: 3,
      light: 1,
      failed: 0,
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
      light: 3,
      failed: 0,
      pending: 0,
      wav: 0,
      running: false,
      available: true,
    });
  });

  it("answers 202 with nothing queued when there is nothing to do", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    seed("done", { format: "flac", attempted: true, aacSize: 5 });
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

describe("failures and manual retry", () => {
  const uploadWav = async (cookie: string, seconds: number) => {
    const file = path.join(t.tempDir, `src-${seconds}.wav`);
    writeWav(file, seconds);
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(await readFile(file))]), `song-${seconds}.wav`);
    const res = await t.app.request("/api/admin/imports", {
      method: "POST",
      body: form,
      headers: { cookie, ...H },
    });
    assert.equal(res.status, 202);
  };

  it("does not retry a WAV whose conversion failed when a second import starts a pass", async () => {
    let conversions = 0;
    t = createTestApp({
      convertWav: async () => {
        conversions += 1;
        return false;
      },
      encodeAac: fakeAac,
    });
    const cookie = t.loginAs("admin");
    await uploadWav(cookie, 1);
    await t.imports.idle();
    // One attempt at the import itself, one by the pass.
    const afterFirst = conversions;
    assert.ok(afterFirst >= 1);
    await uploadWav(cookie, 2);
    await t.imports.idle();
    // The second upload adds its own two attempts, the first track none.
    assert.equal(conversions, afterFirst * 2);
    assert.equal(
      (t.db.prepare("SELECT COUNT(*) AS n FROM tracks WHERE format = 'wav'").get() as { n: number })
        .n,
      2,
    );
  });

  it("POST retries the failures: a WAV and a track without variant", async () => {
    let healthy = false;
    t = createTestApp({
      convertWav: async (src, dest) => (healthy ? fakeFlac(src, dest) : false),
      encodeAac: async (src, dest) => (healthy ? fakeAac(src, dest) : false),
    });
    const cookie = t.loginAs("admin");
    seed("w");
    seed("f", { format: "flac" });
    seed("ok", { format: "flac", attempted: true, aacSize: 5 });
    assert.deepEqual(await (await post(cookie)).json(), { queued: 2, running: true });
    await t.imports.idle();
    assert.equal(getTrack(t.db, "w")!.format, "wav");
    assert.equal(getTrack(t.db, "f")!.aacSizeBytes, null);
    assert.deepEqual(t.imports.startOptimize().queued, 2, "the manual start clears the stamps");
    await t.imports.idle();

    healthy = true;
    const res = await post(cookie);
    assert.deepEqual(await res.json(), { queued: 2, running: true });
    await t.imports.idle();
    assert.equal(getTrack(t.db, "w")!.format, "flac");
    assert.equal(getTrack(t.db, "w")!.aacSizeBytes, 9);
    assert.equal(getTrack(t.db, "f")!.aacSizeBytes, 9);
    // The track that already had its variant was not touched.
    assert.equal(getTrack(t.db, "ok")!.aacSizeBytes, 5);
  });

  it("removes an original.wav left next to a FLAC row", async () => {
    t = createTestApp({ encodeAac: fakeAac });
    seed("a", { format: "flac" });
    writeFileSync(t.storage.originalPath("a", "wav"), "stale");
    t.imports.startOptimize();
    await t.imports.idle();
    assert.ok(!existsSync(t.storage.originalPath("a", "wav")));
    assert.ok(existsSync(t.storage.originalPath("a", "flac")));
    assert.ok(t.log.some((e) => e.event === "optimize.stale_wav_removed"));
  });

  it("drops a variant that is not smaller than the original", async () => {
    t = createTestApp({ encodeAac: fakeAac });
    seed("a", { format: "flac", sizeBytes: 9 });
    t.imports.startOptimize();
    await t.imports.idle();
    const track = getTrack(t.db, "a")!;
    assert.equal(track.aacSizeBytes, null);
    assert.ok(track.aacAttemptedAt);
    assert.deepEqual(readdirSync(t.storage.mediaPath("a")), ["original.flac"]);
    assert.ok(t.log.some((e) => e.event === "optimize.variant_not_smaller"));
  });

  it("works on a track under its lock, after the other holder is done", async () => {
    let encoded = 0;
    t = createTestApp({
      encodeAac: async (src, dest) => {
        encoded += 1;
        return fakeAac(src, dest);
      },
    });
    seed("a", { format: "flac" });
    let release!: () => void;
    const held = t.trackLocks("a", () => new Promise<void>((resolve) => (release = resolve)));
    t.imports.startOptimize();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(encoded, 0);
    release();
    await held;
    await t.imports.idle();
    assert.equal(encoded, 1);
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

  it("publishes the WAV when the converter wrote something that is not a FLAC", async () => {
    for (const bytes of [Buffer.alloc(0), Buffer.from("definitely not flac")]) {
      const { track } = await ingest(async (_src, dest) => {
        await writeFile(dest, bytes);
        return true;
      });
      assert.equal(track.format, "wav");
      assert.ok(existsSync(t.storage.originalPath(track.id, "wav")));
      t.cleanup();
    }
  });

  it("publishes the WAV as it is when the converter throws", async () => {
    const { track } = await ingest(async () => {
      throw new Error("boom");
    });
    assert.equal(track.format, "wav");
  });
});
