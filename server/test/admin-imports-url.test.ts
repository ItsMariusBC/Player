import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createTestApp } from "./helpers.ts";
import { writeWav } from "./fixtures.ts";

let t: ReturnType<typeof createTestApp>;
let scratch: string;
let wav: Buffer;

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "imports-url-"));
  const file = path.join(scratch, "song.wav");
  writeWav(file, 1);
  wav = readFileSync(file);
});
afterEach(() => {
  t?.cleanup();
  rmSync(scratch, { recursive: true, force: true });
});

const wavResponse = () => new Response(new Uint8Array(wav));

function post(cookie: string | null, body: unknown) {
  return t.app.request("/api/admin/imports/url", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "X-Requested-With": "player",
      ...(cookie ? { cookie } : {}),
    },
  });
}

const row = (id: string) =>
  t.db.prepare("SELECT * FROM imports WHERE id = ?").get(id) as Record<string, any>;
const incomingNames = () => {
  const dir = path.join(t.tempDir, "incoming");
  return existsSync(dir) ? readdirSync(dir) : [];
};

describe("POST /api/admin/imports/url", () => {
  it("requires an admin", async () => {
    t = createTestApp();
    assert.equal((await post(null, { url: "https://example.com/a.wav" })).status, 401);
    assert.equal((await post(t.loginAs("user"), { url: "https://example.com/a.wav" })).status, 403);
  });

  it("rejects invalid bodies and URLs with 400 bad_request", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const bad: unknown[] = [
      "not json",
      null,
      {},
      { url: 5 },
      { url: "" },
      { url: "not a url" },
      { url: "http://example.com/a.wav" },
      { url: "ftp://example.com/a.wav" },
      { url: "https://93.184.216.34/a.wav" },
      { url: "https://[2606:4700::1]/a.wav" },
      { url: `https://example.com/${"a".repeat(2048)}` },
      { url: "https://example.com/a.wav", folderId: "missing" },
      { url: "https://example.com/a.wav", folderId: 4 },
    ];
    for (const body of bad) {
      const res = await post(cookie, body);
      assert.equal(res.status, 400, JSON.stringify(body)?.slice(0, 60));
      assert.equal(((await res.json()) as any).error.code, "bad_request");
    }
    assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM imports").get() as any).n, 0);
  });

  it("answers 202 with an immediate row, then imports the downloaded file into the folder", async () => {
    const seen: string[] = [];
    t = createTestApp({
      download: {
        fetch: async (input) => {
          seen.push(String(input));
          return wavResponse();
        },
      },
    });
    const cookie = t.loginAs("admin");
    t.db.prepare("INSERT INTO folders (id, name, created_at) VALUES ('f1', 'Rock', 'x')").run();
    const res = await post(cookie, {
      url: "https://example.com/dir/My%20Song%20(live).wav?token=secret",
      folderId: "f1",
    });
    assert.equal(res.status, 202);
    const { importId } = (await res.json()) as { importId: string };
    const created = row(importId);
    assert.equal(created.state, "processing");
    assert.equal(created.filename, "My_Song__live_.wav");
    assert.equal(created.folder_id, "f1");
    assert.equal(created.source_url, "https://example.com/dir/My%20Song%20(live).wav?token=secret");
    await t.imports.idle();
    const done = row(importId);
    assert.equal(done.state, "ready");
    assert.equal(done.error, null);
    const track = t.db.prepare("SELECT * FROM tracks WHERE id = ?").get(done.track_id) as any;
    assert.equal(track.folder_id, "f1");
    assert.equal(seen.length, 1);
    assert.deepEqual(incomingNames(), []);
    const listed = (await (
      await t.app.request("/api/admin/imports/" + importId, { headers: { cookie } })
    ).json()) as any;
    assert.equal(listed.state, "ready");
  });

  it("defaults the filename to download", async () => {
    t = createTestApp({ download: { fetch: async () => new Response("x", { status: 404 }) } });
    const cookie = t.loginAs("admin");
    const res = await post(cookie, { url: "https://example.com/" });
    const { importId } = (await res.json()) as { importId: string };
    assert.equal(row(importId).filename, "download");
    await t.imports.idle();
  });

  it("fails with forbidden_host when the host resolves to a private address", async () => {
    let fetched = 0;
    t = createTestApp({
      download: {
        resolve: async () => ["192.168.1.10"],
        fetch: async () => {
          fetched += 1;
          return wavResponse();
        },
      },
    });
    const cookie = t.loginAs("admin");
    const res = await post(cookie, { url: "https://nas.example.com/a.wav?k=secret" });
    const { importId } = (await res.json()) as { importId: string };
    await t.imports.idle();
    const failed = row(importId);
    assert.equal(failed.state, "failed");
    assert.deepEqual(JSON.parse(failed.error), {
      reason: "download_failed",
      detail: "forbidden_host",
    });
    assert.equal(fetched, 0);
    assert.deepEqual(incomingNames(), []);
    const entry = t.log.find((l) => l.event === "import.download_failed");
    assert.ok(entry);
    assert.equal(entry.data?.["importId"], importId);
    assert.equal(entry.data?.["detail"], "forbidden_host");
    assert.equal(entry.data?.["host"], "nas.example.com");
    assert.ok(!JSON.stringify(entry).includes("secret"));
    assert.ok(!JSON.stringify(entry).includes("a.wav"));
  });

  it("fails with too_large by Content-Length and by stream", async () => {
    const big = 1024 * 1024 + 1;
    t = createTestApp({
      env: { MAX_UPLOAD_MB: "1" },
      download: {
        fetch: async (input) =>
          String(input).endsWith("/header")
            ? new Response("tiny", { headers: { "content-length": String(big) } })
            : new Response(new Uint8Array(big)),
      },
    });
    const cookie = t.loginAs("admin");
    const ids: string[] = [];
    for (const name of ["header", "stream"]) {
      const res = await post(cookie, { url: `https://example.com/${name}` });
      ids.push(((await res.json()) as any).importId);
    }
    await t.imports.idle();
    for (const id of ids) {
      assert.equal(row(id).state, "failed");
      assert.deepEqual(JSON.parse(row(id).error), {
        reason: "download_failed",
        detail: "too_large",
      });
    }
    assert.deepEqual(incomingNames(), []);
  });

  it("refuses a redirect to http", async () => {
    t = createTestApp({
      download: {
        fetch: async () =>
          new Response(null, { status: 302, headers: { location: "http://example.com/a.wav" } }),
      },
    });
    const cookie = t.loginAs("admin");
    const res = await post(cookie, { url: "https://example.com/a.wav" });
    const { importId } = (await res.json()) as { importId: string };
    await t.imports.idle();
    assert.deepEqual(JSON.parse(row(importId).error), {
      reason: "download_failed",
      detail: "redirect",
    });
  });

  it("reports http_<status> and unreachable", async () => {
    t = createTestApp({
      download: {
        fetch: async (input) => {
          if (String(input).endsWith("/gone")) return new Response("", { status: 410 });
          throw new Error("ECONNREFUSED");
        },
      },
    });
    const cookie = t.loginAs("admin");
    const a = ((await (await post(cookie, { url: "https://example.com/gone" })).json()) as any)
      .importId;
    const b = ((await (await post(cookie, { url: "https://example.com/down" })).json()) as any)
      .importId;
    await t.imports.idle();
    assert.equal(JSON.parse(row(a).error).detail, "http_410");
    assert.equal(JSON.parse(row(b).error).detail, "unreachable");
  });

  it("runs at most two downloads at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const gates: (() => void)[] = [];
    let started = 0;
    t = createTestApp({
      download: {
        fetch: async () => {
          started += 1;
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise<void>((resolve) => gates.push(resolve));
          inFlight -= 1;
          return wavResponse();
        },
      },
    });
    const cookie = t.loginAs("admin");
    for (const n of [1, 2, 3]) {
      assert.equal((await post(cookie, { url: `https://example.com/${n}.wav` })).status, 202);
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
    await settle();
    assert.equal(started, 2);
    assert.equal(peak, 2);
    gates.shift()!();
    await settle();
    assert.equal(started, 3);
    assert.equal(peak, 2);
    while (gates.length) gates.shift()!();
    await settle();
    while (gates.length) gates.shift()!();
    await t.imports.idle();
    assert.equal(peak, 2);
    const states = t.db.prepare("SELECT state FROM imports").all() as { state: string }[];
    // The three downloads serve the same file: one track, two duplicates.
    assert.equal(states.filter((s) => s.state === "ready").length, 1);
    assert.equal(states.filter((s) => s.state === "failed").length, 2);
  });
});
