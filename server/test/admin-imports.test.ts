import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { recoverStaleImports } from "../src/admin/imports.ts";
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

  it("exposes the upload limit to admins only", async () => {
    t = createTestApp({ env: { MAX_UPLOAD_MB: "3" } });
    const res = await t.app.request("/api/admin/limits", {
      headers: { cookie: t.loginAs("admin") },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { maxUploadBytes: 3 * 1024 * 1024 });
    const forbidden = await t.app.request("/api/admin/limits", {
      headers: { cookie: t.loginAs("user") },
    });
    assert.equal(forbidden.status, 403);
    assert.equal((await t.app.request("/api/admin/limits")).status, 401);
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

  it("retries the insert in the inbox when the folder disappears after the check", async () => {
    t = createTestApp();
    const { ingestFile } = await import("../src/media/ingest.ts");
    const file = path.join(t.storage.incomingDir("gone"), "upload.bin");
    writeWav(file, 1);
    t.db.prepare("INSERT INTO folders (id, name, created_at) VALUES ('f1', 'Rock', 'x')").run();
    const result = await ingestFile({
      db: t.db,
      storage: t.storage,
      importId: "gone",
      file,
      now: t.now(),
      // Returns an id that no longer exists by the time the row is inserted.
      folderId: () => {
        t.db.prepare("DELETE FROM folders WHERE id = 'f1'").run();
        return "f1";
      },
    });
    assert.equal(result.kind, "ready");
    if (result.kind === "ready") assert.equal(result.track.folderId, null);
    const rows = t.db.prepare("SELECT folder_id FROM tracks").all() as {
      folder_id: string | null;
    }[];
    assert.deepEqual(
      rows.map((row) => row.folder_id),
      [null],
    );
  });

  describe("recoverStaleImports", () => {
    it("fails processing imports, removes their uploads and orphan directories", async () => {
      t = createTestApp();
      t.loginAs("admin");
      const user = (t.db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }).id;
      const insert = t.db.prepare(
        "INSERT INTO imports (id, user_id, filename, state, error, created_at, updated_at) VALUES (?, ?, 'a.wav', ?, ?, 'x', 'x')",
      );
      insert.run("stale", user, "processing", null);
      insert.run("done", user, "ready", null);
      insert.run("bad", user, "failed", '{"reason":"duplicate"}');
      for (const id of ["stale", "done", "orphan"]) {
        writeFileSync(path.join(t.storage.incomingDir(id), "upload.bin"), "x");
      }
      const logged: unknown[] = [];
      const count = await recoverStaleImports({
        db: t.db,
        storage: t.storage,
        log: (event, data) => logged.push({ event, data }),
        now: () => new Date("2026-10-27T00:00:00Z"),
      });
      assert.equal(count, 1);
      assert.deepEqual(logged, [{ event: "imports.recovered", data: { count: 1 } }]);
      const rows = t.db.prepare("SELECT * FROM imports ORDER BY id").all() as any[];
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      assert.equal(byId.stale.state, "failed");
      assert.equal(JSON.parse(byId.stale.error).reason, "internal");
      assert.equal(byId.stale.updated_at, "2026-10-27T00:00:00.000Z");
      assert.equal(byId.done.state, "ready");
      assert.equal(byId.done.updated_at, "x");
      assert.equal(byId.bad.error, '{"reason":"duplicate"}');
      const left = readdirSync(path.join(t.tempDir, "incoming"));
      assert.deepEqual(left, ["done"]);
    });
  });
});

describe("admin imports into a folder", () => {
  const send = (cookie: string, build: (form: FormData) => void) => {
    const form = new FormData();
    build(form);
    return t.app.request("/api/admin/imports", {
      method: "POST",
      body: form,
      headers: { cookie, "X-Requested-With": "player" },
    });
  };
  const addFolder = () =>
    t.db.prepare("INSERT INTO folders (id, name, created_at) VALUES ('f1', 'Rock', 'x')").run();
  const blob = () => new Blob([new Uint8Array(wavFile())]);

  it("stores the folder of a folderId sent before the file", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    addFolder();
    const res = await send(cookie, (form) => {
      form.set("folderId", "f1");
      form.set("file", blob(), "song.wav");
    });
    assert.equal(res.status, 202);
    const { importId } = (await res.json()) as { importId: string };
    await t.imports.idle();
    const imp = t.db.prepare("SELECT * FROM imports WHERE id = ?").get(importId) as any;
    assert.equal(imp.folder_id, "f1");
    assert.equal(imp.state, "ready");
    const track = t.db
      .prepare("SELECT folder_id FROM tracks WHERE id = ?")
      .get(imp.track_id) as any;
    assert.equal(track.folder_id, "f1");
  });

  it("answers 400 bad_request for an unknown folder and leaves nothing behind", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const res = await send(cookie, (form) => {
      form.set("folderId", "nope");
      form.set("file", blob(), "song.wav");
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as any).error.code, "bad_request");
    assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM imports").get() as any).n, 0);
    assert.ok(incomingEmpty());
  });

  it("ignores a folderId sent after the file (parts are read in order)", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    addFolder();
    const res = await send(cookie, (form) => {
      form.set("file", blob(), "song.wav");
      form.set("folderId", "f1");
    });
    assert.equal(res.status, 202);
    const { importId } = (await res.json()) as { importId: string };
    await t.imports.idle();
    const imp = t.db.prepare("SELECT folder_id FROM imports WHERE id = ?").get(importId) as any;
    assert.equal(imp.folder_id, null);
  });

  it("falls back to the inbox when the folder is deleted before the import runs", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    addFolder();
    const res = await send(cookie, (form) => {
      form.set("folderId", "f1");
      form.set("file", blob(), "song.wav");
    });
    const { importId } = (await res.json()) as { importId: string };
    t.db.prepare("DELETE FROM folders WHERE id = 'f1'").run();
    await t.imports.idle();
    const imp = t.db.prepare("SELECT * FROM imports WHERE id = ?").get(importId) as any;
    assert.equal(imp.state, "ready");
    const track = t.db
      .prepare("SELECT folder_id FROM tracks WHERE id = ?")
      .get(imp.track_id) as any;
    assert.equal(track.folder_id, null);
  });
});
