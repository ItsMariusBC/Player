import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { parseFile } from "music-metadata";
import NodeID3 from "node-id3";
import { writeTags } from "../src/media/tags.ts";
import { writeFlac, writeMp3, writeWav } from "./fixtures.ts";

const require = createRequire(import.meta.url);
const Metaflac = require("metaflac-js") as new (file: string) => {
  setTag(field: string): void;
  save(): void;
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tags-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const tags = { title: "Nouveau titre", artist: "Artiste é", album: "Album" };

describe("writeTags", () => {
  it("updates MP3 frames and keeps the other ones", async () => {
    const file = path.join(dir, "a.mp3");
    writeMp3(file);
    NodeID3.write({ title: "Old", genre: "Jazz" }, file);
    assert.equal(NodeID3.read(file).genre, "Jazz");
    assert.equal(await writeTags(file, "mp3", tags), true);
    const read = NodeID3.read(file);
    assert.equal(read.title, tags.title);
    assert.equal(read.artist, tags.artist);
    assert.equal(read.album, tags.album);
    assert.equal(read.genre, "Jazz");
  });

  it("replaces FLAC vorbis comments and keeps the other ones", async () => {
    const file = path.join(dir, "a.flac");
    writeFlac(file);
    const flac = new Metaflac(file);
    flac.setTag("TITLE=Old");
    flac.setTag("GENRE=Rock");
    flac.save();
    assert.equal(await writeTags(file, "flac", tags), true);
    const metadata = await parseFile(file);
    assert.equal(metadata.common.title, tags.title);
    assert.equal(metadata.common.artist, tags.artist);
    assert.equal(metadata.common.album, tags.album);
    assert.deepEqual(metadata.common.genre, ["Rock"]);
    const titles = metadata.native["vorbis"]?.filter((t) => t.id === "TITLE") ?? [];
    assert.equal(titles.length, 1);
  });

  it("returns false for WAV and leaves the file untouched", async () => {
    const file = path.join(dir, "a.wav");
    writeWav(file, 1);
    const before = readFileSync(file);
    assert.equal(await writeTags(file, "wav", tags), false);
    assert.deepEqual(readFileSync(file), before);
  });

  it("returns false when the library fails", async () => {
    const file = path.join(dir, "broken.flac");
    writeFileSync(file, Buffer.from("not a flac file"));
    assert.equal(await writeTags(file, "flac", tags), false);
    assert.equal(await writeTags(path.join(dir, "missing.mp3"), "mp3", tags), false);
  });
});
