import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { insertTrack } from "../src/catalog/tracks.ts";
import { writeWav } from "./fixtures.ts";
import { createTestApp } from "./helpers.ts";

const now = new Date("2026-01-01T00:00:00.000Z");
let ctx: ReturnType<typeof createTestApp>;
let trackId: string;
let size: number;

function addTrack(status: "ready" | "failed", coverExt: "png" | null = null, sha = "sha-x") {
  const id = crypto.randomUUID();
  insertTrack(
    ctx.db,
    {
      id,
      folderId: null,
      title: "t",
      artist: "",
      album: "",
      durationMs: 1000,
      format: "wav",
      sizeBytes: 10,
      sha256: sha,
      coverExt,
      status,
    },
    now,
  );
  return id;
}

function place(id: string): number {
  const file = ctx.storage.originalPath(id, "wav");
  mkdirSync(path.dirname(file), { recursive: true });
  const src = path.join(ctx.tempDir, "src.wav");
  writeWav(src, 1);
  copyFileSync(src, file);
  return statSync(file).size;
}

beforeEach(() => {
  ctx = createTestApp();
  trackId = addTrack("ready");
  size = place(trackId);
});
afterEach(() => ctx.cleanup());

const get = (
  url: string,
  who: string | null,
  headers: Record<string, string> = {},
  method = "GET",
) =>
  ctx.app.request(url, {
    method,
    headers: { ...(who ? { cookie: ctx.loginAs(who) } : {}), ...headers },
  });

describe("GET /api/media/:trackId", () => {
  it("sends no bytes without a session", async () => {
    const res = await get(`/api/media/${trackId}`, null);
    assert.equal(res.status, 401);
    assert.match(res.headers.get("content-type") ?? "", /json/);
    const text = await res.text();
    assert.ok(text.length < 200);
    assert.ok(text.includes("session_required"));
  });

  it("rejects accounts without group", async () => {
    const res = await get(`/api/media/${trackId}`, "nobody");
    assert.equal(res.status, 403);
    assert.match(res.headers.get("content-type") ?? "", /json/);
  });

  it("serves the full file to a user", async () => {
    const res = await get(`/api/media/${trackId}`, "user");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "audio/wav");
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    assert.equal(res.headers.get("content-length"), String(size));
    assert.equal((await res.arrayBuffer()).byteLength, size);
  });

  it("serves the full file to an admin", async () => {
    const res = await get(`/api/media/${trackId}`, "admin");
    assert.equal(res.status, 200);
  });

  it("answers HEAD with headers and no body", async () => {
    const res = await get(`/api/media/${trackId}`, "user", {}, "HEAD");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-length"), String(size));
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    assert.equal((await res.arrayBuffer()).byteLength, 0);
  });

  it("answers a range with 206", async () => {
    const res = await get(`/api/media/${trackId}`, "user", { range: "bytes=0-99" });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), `bytes 0-99/${size}`);
    assert.equal(res.headers.get("content-length"), "100");
    assert.equal((await res.arrayBuffer()).byteLength, 100);
  });

  it("answers a suffix range", async () => {
    const res = await get(`/api/media/${trackId}`, "user", { range: "bytes=-10" });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), `bytes ${size - 10}-${size - 1}/${size}`);
    assert.equal((await res.arrayBuffer()).byteLength, 10);
  });

  it("answers an unsatisfiable range with 416", async () => {
    const res = await get(`/api/media/${trackId}`, "user", { range: `bytes=${size}-` });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get("content-range"), `bytes */${size}`);
  });

  it("returns 404 for unknown and failed tracks", async () => {
    const unknown = await get(`/api/media/${crypto.randomUUID()}`, "user");
    assert.equal(unknown.status, 404);
    const failed = addTrack("failed", null, "sha-f");
    place(failed);
    const res = await get(`/api/media/${failed}`, "user");
    assert.equal(res.status, 404);
    assert.match(res.headers.get("content-type") ?? "", /json/);
  });

  it("returns 404 when the file is missing on disk", async () => {
    const id = addTrack("ready", null, "sha-m");
    const res = await get(`/api/media/${id}`, "user");
    assert.equal(res.status, 404);
  });
});

describe("GET /api/media/:trackId/cover", () => {
  it("requires a session", async () => {
    const res = await get(`/api/media/${trackId}/cover`, null);
    assert.equal(res.status, 401);
  });

  it("returns 404 without a cover, then 200 with the right headers", async () => {
    const none = await get(`/api/media/${trackId}/cover`, "user");
    assert.equal(none.status, 404);

    const id = addTrack("ready", "png", "sha-c");
    mkdirSync(path.dirname(ctx.storage.coverPath(id, "png")), { recursive: true });
    writeFileSync(ctx.storage.coverPath(id, "png"), Buffer.from("PNGDATA"));
    const res = await get(`/api/media/${id}/cover`, "user");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("cache-control"), "private, max-age=300");
    assert.equal(await res.text(), "PNGDATA");
  });
});
