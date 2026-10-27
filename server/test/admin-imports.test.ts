import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createTestApp } from "./helpers.ts";
import { writeMp3, writeWav } from "./fixtures.ts";

let t: ReturnType<typeof createTestApp>;
let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "imports-"));
});
afterEach(() => {
  t?.cleanup();
  rmSync(scratch, { recursive: true, force: true });
});

function wavFile(name = "song.wav", seconds = 1): Buffer {
  const file = path.join(scratch, name);
  writeWav(file, seconds);
  return readFileSync(file);
}

function upload(
  cookie: string | null,
  body: Buffer | null,
  filename = "song.wav",
  headers: Record<string, string> = { "X-Requested-With": "player" },
) {
  const form = new FormData();
  if (body) form.set("file", new Blob([new Uint8Array(body)]), filename);
  else form.set("other", "x");
  return t.app.request("/api/admin/imports", {
    method: "POST",
    body: form,
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });
}

const incomingEmpty = () => {
  const dir = path.join(t.tempDir, "incoming");
  return !existsSync(dir) || readdirSync(dir).length === 0;
};

async function status(cookie: string, id: string) {
  const res = await t.app.request(`/api/admin/imports/${id}`, { headers: { cookie } });
  return { res, body: (await res.json()) as Record<string, any> };
}

describe("admin imports", () => {
  it("imports a WAV: 202, then ready with a published original", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const res = await upload(cookie, wavFile(), "My Song.wav");
    assert.equal(res.status, 202);
    const { importId } = (await res.json()) as { importId: string };
    assert.equal((await status(cookie, importId)).body["state"], "processing");
    await t.imports.idle();
    const { body } = await status(cookie, importId);
    assert.equal(body["state"], "ready");
    assert.equal(body["filename"], "My Song.wav");
    assert.equal(body["error"], null);
    assert.ok(typeof body["trackId"] === "string");
    assert.ok(existsSync(path.join(t.tempDir, "media", body["trackId"], "original.wav")));
    assert.ok(incomingEmpty());
    const event = t.db.prepare("SELECT * FROM admin_events WHERE action = 'import'").get() as any;
    assert.equal(event.track_id, body["trackId"]);
    assert.equal(JSON.parse(event.detail).importId, importId);
    const listed = await t.app.request("/api/admin/imports?limit=10", { headers: { cookie } });
    assert.equal(((await listed.json()) as any[]).length, 1);
  });

  it("rejects a fake mp3 as unsupported_format and cleans incoming", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const res = await upload(cookie, Buffer.from("not audio"), "bad.mp3");
    const { importId } = (await res.json()) as { importId: string };
    await t.imports.idle();
    const { body } = await status(cookie, importId);
    assert.equal(body["state"], "failed");
    assert.deepEqual(body["error"], { reason: "unsupported_format" });
    assert.ok(incomingEmpty());
  });

  it("accepts a real mp3", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const file = path.join(scratch, "a.mp3");
    writeMp3(file);
    const res = await upload(cookie, readFileSync(file), "a.mp3");
    const { importId } = (await res.json()) as { importId: string };
    await t.imports.idle();
    assert.equal((await status(cookie, importId)).body["state"], "ready");
  });

  async function twice(concurrent: boolean) {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const data = wavFile();
    let responses;
    if (concurrent) responses = await Promise.all([upload(cookie, data), upload(cookie, data)]);
    else responses = [await upload(cookie, data), await upload(cookie, data)];
    const ids = await Promise.all(
      responses.map(async (r) => ((await r.json()) as { importId: string }).importId),
    );
    await t.imports.idle();
    const results = await Promise.all(ids.map(async (id) => (await status(cookie, id)).body));
    const ready = results.filter((r) => r["state"] === "ready");
    const failed = results.filter((r) => r["state"] === "failed");
    assert.equal(ready.length, 1);
    assert.equal(failed.length, 1);
    assert.equal(failed[0]!["error"].reason, "duplicate");
    assert.equal(failed[0]!["error"].trackId, ready[0]!["trackId"]);
    assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM tracks").get() as any).n, 1);
    assert.ok(incomingEmpty());
  }
  it("marks a sequential duplicate as failed duplicate", () => twice(false));
  it("marks a concurrent duplicate as failed duplicate", () => twice(true));

  it("answers 413 above the limit and leaves no incoming file", async () => {
    t = createTestApp({ env: { MAX_UPLOAD_MB: "1" } });
    const cookie = t.loginAs("admin");
    const res = await upload(cookie, Buffer.alloc(1.5 * 1024 * 1024, 1), "big.wav");
    assert.equal(res.status, 413);
    assert.equal(((await res.json()) as any).error.code, "too_large");
    await t.imports.idle();
    assert.ok(incomingEmpty());
    assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM imports").get() as any).n, 0);
  });

  it("forbids the user role and missing CSRF header, requires a session", async () => {
    t = createTestApp();
    const data = wavFile();
    assert.equal((await upload(t.loginAs("user"), data)).status, 403);
    assert.equal((await upload(t.loginAs("admin"), data, "s.wav", {})).status, 403);
    assert.equal((await upload(null, data)).status, 401);
    const read = await t.app.request("/api/admin/imports", {
      headers: { cookie: t.loginAs("user") },
    });
    assert.equal(read.status, 403);
  });

  it("answers 400 without a file field and 404 for an unknown import", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const res = await upload(cookie, null);
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as any).error.code, "bad_request");
    assert.ok(incomingEmpty());
    assert.equal((await status(cookie, "nope")).res.status, 404);
  });

  it("answers 400 for a non-multipart body", async () => {
    t = createTestApp();
    const res = await t.app.request("/api/admin/imports", {
      method: "POST",
      body: "x",
      headers: { cookie: t.loginAs("admin"), "X-Requested-With": "player" },
    });
    assert.equal(res.status, 400);
  });
});

describe("ingestFile race", () => {
  it("reports duplicate when the unique constraint fires after the dedupe check", async () => {
    t = createTestApp();
    const { ingestFile } = await import("../src/media/ingest.ts");
    const { insertTrack } = await import("../src/catalog/tracks.ts");
    const { probeFile } = await import("../src/media/probe.ts");
    const file = path.join(t.storage.incomingDir("race"), "upload.bin");
    writeWav(file, 1);
    const sha = (await probeFile(file)).sha256;
    // The folder resolver runs between the dedupe check and the insert: slip the rival row in there.
    const result = await ingestFile({
      db: t.db,
      storage: t.storage,
      importId: "race",
      file,
      now: t.now(),
      folderId: () => {
        insertTrack(
          t.db,
          {
            id: "rival",
            folderId: null,
            title: "r",
            artist: "",
            album: "",
            durationMs: null,
            format: "wav",
            sizeBytes: 1,
            sha256: sha,
            coverExt: null,
            status: "ready",
          },
          t.now(),
        );
        return null;
      },
    });
    assert.deepEqual(result, { kind: "duplicate", trackId: "rival" });
    assert.ok(!existsSync(path.join(t.tempDir, "incoming", "race")));
  });
});
