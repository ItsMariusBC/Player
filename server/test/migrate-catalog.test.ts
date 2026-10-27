import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { listFolders } from "../src/catalog/folders.ts";
import { listTracks } from "../src/catalog/tracks.ts";
import { openDatabase } from "../src/db.ts";
import { createMediaStorage } from "../src/media/storage.ts";
import { migrate } from "../src/migrations.ts";
import { migrateCatalog } from "../src/migrate-catalog.ts";
import { writeWav } from "./fixtures.ts";

const now = new Date("2026-01-01T00:00:00.000Z");
let root: string;
let source: string;
let db: ReturnType<typeof openDatabase>;
let storage: ReturnType<typeof createMediaStorage>;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "migrate-"));
  source = path.join(root, "source");
  mkdirSync(source);
  db = openDatabase(":memory:");
  migrate(db);
  storage = createMediaStorage(path.join(root, "data"));
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const run = (manifest?: Parameters<typeof migrateCatalog>[0]["manifest"]) =>
  migrateCatalog({ db, storage, sourceDir: source, manifest, now });

describe("migrateCatalog", () => {
  it("imports with manifest data, creates the folder, stores the cover, and is idempotent", async () => {
    writeWav(path.join(source, "Drops.wav"), 1);
    writeFileSync(path.join(source, "Drops.png"), Buffer.from("png-bytes"));
    const manifest = [
      {
        name: "Drops Mix",
        author: "Crate",
        url: "/Drops.wav",
        picture: "/Drops.png",
        folder: "Chill",
      },
    ];
    const first = await run(manifest);
    assert.deepEqual(first, { imported: 1, skipped: 0, failed: [] });
    const folders = listFolders(db);
    assert.equal(folders.length, 1);
    assert.equal(folders[0]!.name, "Chill");
    const [track] = listTracks(db);
    assert.equal(track!.title, "Drops Mix");
    assert.equal(track!.artist, "Crate");
    assert.equal(track!.folderId, folders[0]!.id);
    assert.equal(track!.coverExt, "png");
    assert.equal(readFileSync(storage.coverPath(track!.id, "png"), "utf8"), "png-bytes");
    assert.ok(existsSync(path.join(source, "Drops.wav")), "source is left untouched");

    const second = await run(manifest);
    assert.deepEqual(second, { imported: 0, skipped: 1, failed: [] });
    assert.equal(listFolders(db).length, 1);
  });

  it("reports an unsupported file and keeps importing the others", async () => {
    writeFileSync(path.join(source, "bad.mp3"), "not audio");
    writeWav(path.join(source, "good.wav"), 1);
    const report = await run();
    assert.equal(report.imported, 1);
    assert.equal(report.failed.length, 1);
    assert.equal(report.failed[0]!.file, "bad.mp3");
    assert.equal(report.failed[0]!.reason, "unsupported_format");
    assert.equal(listTracks(db)[0]!.title, "good");
  });

  it("creates nested folders from sub-directories", async () => {
    mkdirSync(path.join(source, "Sub", "Deep"), { recursive: true });
    writeWav(path.join(source, "Sub", "Deep", "x.wav"), 1);
    const report = await run();
    assert.equal(report.imported, 1);
    const folders = listFolders(db);
    const sub = folders.find((f) => f.name === "Sub")!;
    const deep = folders.find((f) => f.name === "Deep")!;
    assert.equal(sub.parentId, null);
    assert.equal(deep.parentId, sub.id);
    assert.equal(listTracks(db)[0]!.folderId, deep.id);
  });

  it("orders manifest entries first, then the rest alphabetically", async () => {
    writeWav(path.join(source, "a.wav"), 1);
    writeWav(path.join(source, "b.wav"), 2);
    writeWav(path.join(source, "c.wav"), 3);
    await run([{ name: "C", author: "", url: "/c.wav" }]);
    const titles = listTracks(db)
      .sort((x, y) => x.position - y.position)
      .map((t) => t.title);
    assert.deepEqual(titles, ["C", "a", "b"]);
  });
});
