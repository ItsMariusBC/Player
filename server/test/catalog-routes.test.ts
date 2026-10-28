import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createFolder } from "../src/catalog/folders.ts";
import { insertTrack } from "../src/catalog/tracks.ts";
import { createTestApp } from "./helpers.ts";

const now = new Date("2026-01-01T00:00:00.000Z");
let ctx: ReturnType<typeof createTestApp>;

afterEach(() => ctx.cleanup());

function add(title: string, folderId: string | null, sha: string, coverExt: string | null = null) {
  return insertTrack(
    ctx.db,
    {
      id: crypto.randomUUID(),
      folderId,
      title,
      artist: "Art",
      album: "Alb",
      durationMs: 1000,
      format: "wav",
      sizeBytes: 10,
      sha256: sha,
      coverExt,
      status: "ready",
    },
    now,
  );
}

describe("GET /api/catalog", () => {
  it("requires a session", async () => {
    ctx = createTestApp();
    const res = await ctx.app.request("/api/catalog");
    assert.equal(res.status, 401);
  });

  it("rejects accounts without group", async () => {
    ctx = createTestApp();
    const res = await ctx.app.request("/api/catalog", {
      headers: { cookie: ctx.loginAs("nobody") },
    });
    assert.equal(res.status, 403);
  });

  it("returns the tree and the tracks for user and admin", async () => {
    ctx = createTestApp();
    const b = createFolder(ctx.db, { parentId: null, name: "B" }, now);
    const a = createFolder(ctx.db, { parentId: null, name: "A" }, now);
    const sub = createFolder(ctx.db, { parentId: a.id, name: "Sub" }, now);
    add("first", a.id, "s1", "jpg");
    add("second", a.id, "s2");
    add("root", null, "s3");
    for (const who of ["user", "admin"]) {
      const res = await ctx.app.request("/api/catalog", { headers: { cookie: ctx.loginAs(who) } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "private, no-store");
      const body = (await res.json()) as {
        folders: { id: string; name: string; children: { id: string }[] }[];
        tracks: Record<string, unknown>[];
      };
      assert.deepEqual(
        body.folders.map((f) => f.name),
        ["B", "A"],
      );
      assert.equal(body.folders[0]?.id, b.id);
      assert.deepEqual(
        body.folders[1]?.children.map((f) => f.id),
        [sub.id],
      );
      const inA = body.tracks.filter((t) => t.folderId === a.id);
      assert.deepEqual(
        inA.map((t) => t.title),
        ["first", "second"],
      );
      assert.deepEqual(
        inA.map((t) => t.hasCover),
        [true, false],
      );
      assert.deepEqual(Object.keys(inA[0] ?? {}).sort(), [
        "album",
        "artist",
        "durationMs",
        "folderId",
        "format",
        "hasCover",
        "hasLight",
        "id",
        "loudnessLufs",
        "position",
        "title",
        "truePeakDbtp",
        "updatedAt",
      ]);
      assert.equal(inA[0]?.updatedAt, now.toISOString());
    }
  });
});
