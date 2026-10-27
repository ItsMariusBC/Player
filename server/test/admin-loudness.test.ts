import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { insertTrack, getTrack } from "../src/catalog/tracks.ts";
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
      pending: 2,
      available: true,
    });
    const res = await post(cookie);
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { queued: 2 });
    await t.imports.idle();
    assert.equal(measured.length, 2);
    assert.ok(measured.every((f) => !f.includes("done") && !f.includes("broken")));
    assert.deepEqual(await (await get(cookie)).json(), {
      total: 3,
      measured: 3,
      pending: 0,
      available: true,
    });
    const a = getTrack(t.db, "a");
    assert.equal(a?.loudnessLufs, -18.5);
    assert.equal(a?.truePeakDbtp, -2);
    const event = t.db
      .prepare("SELECT detail FROM admin_events WHERE action = 'loudness_backfill'")
      .get() as { detail: string };
    assert.deepEqual(JSON.parse(event.detail), { queued: 2 });
    assert.deepEqual(await (await post(cookie)).json(), { queued: 0 });
  });

  it("leaves a track pending when the measurement is null and skips deleted tracks", async () => {
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
    assert.equal(t.imports.backfillLoudness(), 2);
    t.db.prepare("DELETE FROM tracks WHERE id = 'gone'").run();
    await t.imports.idle();
    assert.equal(calls, 1);
    assert.equal(((await (await get(cookie)).json()) as any).pending, 1);
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
