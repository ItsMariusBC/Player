import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { insertTrack, getTrack } from "../src/catalog/tracks.ts";
import path from "node:path";
import { writeWav } from "./fixtures.ts";
import { createTestApp } from "./helpers.ts";

let t: ReturnType<typeof createTestApp>;
afterEach(() => t?.cleanup());

const H = { "X-Requested-With": "player" };

function seed(id: string, extra: { loudnessLufs?: number; status?: "ready" | "failed" } = {}) {
  insertTrack(
    t.db,
    {
      id,
      folderId: null,
      title: id,
      artist: "",
      album: "",
      durationMs: 1000,
      format: "wav",
      sizeBytes: 1,
      sha256: `sha-${id}`,
      coverExt: null,
      status: extra.status ?? "ready",
      loudnessLufs: extra.loudnessLufs ?? null,
      truePeakDbtp: extra.loudnessLufs === undefined ? null : -3,
    },
    t.now(),
  );
}

const get = (cookie: string) => t.app.request("/api/admin/loudness", { headers: { cookie, ...H } });
const post = (cookie: string) =>
  t.app.request("/api/admin/loudness/backfill", { method: "POST", headers: { cookie, ...H } });

describe("admin loudness", () => {
  it("forbids the user role on both routes", async () => {
    t = createTestApp();
    const cookie = t.loginAs("user");
    assert.equal((await get(cookie)).status, 403);
    assert.equal((await post(cookie)).status, 403);
  });

  it("reports counters before and after a backfill, skipping measured tracks", async () => {
    const measured: string[] = [];
    t = createTestApp({
      measure: async (file) => {
        measured.push(file);
        return { lufs: -18.5, truePeakDbtp: -2 };
      },
    });
    const cookie = t.loginAs("admin");
    seed("a");
    seed("b");
    seed("done", { loudnessLufs: -20 });
    seed("broken", { status: "failed" });
    assert.deepEqual(await (await get(cookie)).json(), {
      total: 3,
      measured: 1,
      failed: 0,
      pending: 2,
      running: false,
      available: true,
    });
    const res = await post(cookie);
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { queued: 2, running: true });
    await t.imports.idle();
    assert.equal(measured.length, 2);
    assert.ok(measured.every((f) => !f.includes("done") && !f.includes("broken")));
    assert.deepEqual(await (await get(cookie)).json(), {
      total: 3,
      measured: 3,
      failed: 0,
      pending: 0,
      running: false,
      available: true,
    });
    const a = getTrack(t.db, "a");
    assert.equal(a?.loudnessLufs, -18.5);
    assert.equal(a?.truePeakDbtp, -2);
    const event = t.db
      .prepare("SELECT detail FROM admin_events WHERE action = 'loudness_backfill'")
      .get() as { detail: string };
    assert.deepEqual(JSON.parse(event.detail), { queued: 2 });
    assert.deepEqual(await (await post(cookie)).json(), { queued: 0, running: false });
  });

  it("counts a null measurement as failed, not pending, and skips deleted tracks", async () => {
    let calls = 0;
    t = createTestApp({
      measure: async () => {
        calls += 1;
        return null;
      },
    });
    const cookie = t.loginAs("admin");
    seed("a");
    seed("gone");
    assert.deepEqual(t.imports.backfillLoudness(), { queued: 2, running: true });
    t.db.prepare("DELETE FROM tracks WHERE id = 'gone'").run();
    await t.imports.idle();
    assert.equal(calls, 1);
    const body = (await (await get(cookie)).json()) as any;
    assert.equal(body.pending, 0);
    assert.equal(body.failed, 1);
    assert.equal(body.measured, 0);
    assert.equal(body.running, false);
    assert.ok(getTrack(t.db, "a")?.loudnessMeasuredAt);
    assert.deepEqual(t.imports.backfillLoudness(), { queued: 0, running: false });
  });

  it("answers a second POST during a pass with queued 0 and records one event", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    t = createTestApp({
      measure: async () => {
        await gate;
        return { lufs: -20, truePeakDbtp: -3 };
      },
    });
    const cookie = t.loginAs("admin");
    seed("a");
    seed("b");
    assert.deepEqual(await (await post(cookie)).json(), { queued: 2, running: true });
    assert.deepEqual(await (await post(cookie)).json(), { queued: 0, running: true });
    assert.equal(((await (await get(cookie)).json()) as any).running, true);
    release();
    await t.imports.idle();
    const body = (await (await get(cookie)).json()) as any;
    assert.equal(body.running, false);
    assert.equal(body.measured, 2);
    const events = t.db
      .prepare("SELECT COUNT(*) AS n FROM admin_events WHERE action = 'loudness_backfill'")
      .get() as { n: number };
    assert.equal(events.n, 1);
  });

  it("lets an import queued during a backfill finish before the third measurement", async () => {
    const gates = new Map<string, () => void>();
    const started: string[] = [];
    t = createTestApp({
      measure: (file) =>
        new Promise((resolve) => {
          const key = file.includes("upload.bin") ? "import" : path.basename(path.dirname(file));
          started.push(key);
          gates.set(key, () => resolve({ lufs: -20, truePeakDbtp: -3 }));
        }),
    });
    const cookie = t.loginAs("admin");
    seed("a");
    seed("b");
    seed("c");
    const waitFor = async (n: number) => {
      for (let i = 0; i < 200 && started.length < n; i++)
        await new Promise((r) => setTimeout(r, 5));
      assert.ok(started.length >= n, `expected ${n} measurements, got ${started.length}`);
    };
    assert.deepEqual(await (await post(cookie)).json(), { queued: 3, running: true });
    await waitFor(1);
    // The first track is being measured: drop an import behind it on the chain.
    const file = path.join(t.storage.incomingDir("imp-mid"), "upload.bin");
    writeWav(file, 1);
    const now = new Date().toISOString();
    const userId = (t.db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }).id;
    t.db
      .prepare(
        "INSERT INTO imports (id, user_id, filename, state, error, track_id, created_at, updated_at) VALUES ('imp-mid', ?, 'mid.wav', 'processing', NULL, NULL, ?, ?)",
      )
      .run(userId, now, now);
    t.imports.enqueue("imp-mid");
    gates.get(started[0]!)!();
    await waitFor(2);
    assert.equal(started[1], "import", "the import runs before the second backfill step");
    gates.get("import")!();
    await waitFor(3);
    const row = t.db.prepare("SELECT state FROM imports WHERE id = 'imp-mid'").get() as {
      state: string;
    };
    assert.equal(row.state, "ready", "the import completed before the third measurement started");
    gates.get(started[2]!)!();
    await waitFor(4);
    gates.get(started[3]!)!();
    await t.imports.idle();
    assert.equal(((await (await get(cookie)).json()) as any).pending, 0);
  });

  it("answers 409 ffmpeg_unavailable without queuing or logging an event", async () => {
    t = createTestApp({
      ffmpegAvailable: false,
      measure: async () => ({ lufs: -20, truePeakDbtp: -3 }),
    });
    const cookie = t.loginAs("admin");
    seed("a");
    const res = await post(cookie);
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as any).error.code, "ffmpeg_unavailable");
    await t.imports.idle();
    assert.equal(((await (await get(cookie)).json()) as any).pending, 1);
    const events = t.db
      .prepare("SELECT COUNT(*) AS n FROM admin_events WHERE action = 'loudness_backfill'")
      .get() as { n: number };
    assert.equal(events.n, 0);
  });

  it("leaves updated_at untouched when a measurement is stored", async () => {
    t = createTestApp({ measure: async () => ({ lufs: -20, truePeakDbtp: -3 }) });
    const cookie = t.loginAs("admin");
    seed("a");
    const before = getTrack(t.db, "a")!.updatedAt.toISOString();
    await post(cookie);
    await t.imports.idle();
    const after = getTrack(t.db, "a")!;
    assert.equal(after.loudnessLufs, -20);
    assert.equal(after.updatedAt.toISOString(), before);
  });

  it("reports available=false when ffmpeg is missing", async () => {
    t = createTestApp({ ffmpegAvailable: false });
    const cookie = t.loginAs("admin");
    seed("a");
    const body = (await (await get(cookie)).json()) as any;
    assert.equal(body.available, false);
    assert.equal(body.pending, 1);
  });

  it("stores the measurement at import and exposes it in the DTO", async () => {
    t = createTestApp();
    const { writeWav } = await import("./fixtures.ts");
    const { ingestFile } = await import("../src/media/ingest.ts");
    const { toTrackDto } = await import("../src/catalog/tracks.ts");
    const path = await import("node:path");
    const file = path.join(t.storage.incomingDir("imp"), "upload.bin");
    writeWav(file, 1);
    const result = await ingestFile({
      db: t.db,
      storage: t.storage,
      importId: "imp",
      file,
      measure: async () => ({ lufs: -16.2, truePeakDbtp: -1.5 }),
      now: t.now(),
    });
    assert.equal(result.kind, "ready");
    if (result.kind !== "ready") return;
    const dto = toTrackDto(result.track);
    assert.equal(dto.loudnessLufs, -16.2);
    assert.equal(dto.truePeakDbtp, -1.5);
    assert.equal(getTrack(t.db, result.track.id)?.loudnessLufs, -16.2);
  });

  it("does not fail the import when the measurement throws or is null", async () => {
    t = createTestApp();
    const { writeWav } = await import("./fixtures.ts");
    const { ingestFile } = await import("../src/media/ingest.ts");
    const path = await import("node:path");
    const file = path.join(t.storage.incomingDir("imp2"), "upload.bin");
    writeWav(file, 1);
    const result = await ingestFile({
      db: t.db,
      storage: t.storage,
      importId: "imp2",
      file,
      measure: async () => {
        throw new Error("boom");
      },
      now: t.now(),
    });
    assert.equal(result.kind, "ready");
    if (result.kind === "ready") assert.equal(result.track.loudnessLufs, null);
  });
});
