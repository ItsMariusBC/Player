import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { probeFile, sniffFormat, UnsupportedFormatError } from "../src/media/probe.ts";
import { createMediaStorage } from "../src/media/storage.ts";
import { writeMp3, writeWav } from "./fixtures.ts";

let dir: string;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "player-"));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("sniffFormat", () => {
  it("recognises flac, mp3 and wav", () => {
    assert.equal(sniffFormat(Buffer.from("fLaC\0\0\0\0\0\0\0\0", "latin1")), "flac");
    assert.equal(sniffFormat(Buffer.from("ID3\x03\0\0\0\0\0\0\0\0", "latin1")), "mp3");
    assert.equal(sniffFormat(Buffer.from([0xff, 0xfb, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0])), "mp3");
    assert.equal(sniffFormat(Buffer.from("RIFF\0\0\0\0WAVE", "latin1")), "wav");
  });

  it("rejects other content", () => {
    assert.equal(sniffFormat(Buffer.from("%PDF-1.7\n%\xe2\xe3", "latin1")), null);
    assert.equal(sniffFormat(Buffer.from("RIFF\0\0\0\0AVI ", "latin1")), null);
    assert.equal(sniffFormat(Buffer.alloc(0)), null);
  });
});

describe("probeFile", () => {
  it("probes a wav", async () => {
    const file = path.join(dir, "a.wav");
    writeWav(file, 1);
    const result = await probeFile(file);
    assert.equal(result.format, "wav");
    assert.ok(result.durationMs !== null && Math.abs(result.durationMs - 1000) < 50);
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
    assert.equal(result.sizeBytes, fs.statSync(file).size);
    assert.equal(result.cover, null);
  });

  it("probes a crafted mp3 without throwing", async () => {
    const file = path.join(dir, "a.mp3");
    writeMp3(file);
    const result = await probeFile(file);
    assert.equal(result.format, "mp3");
  });

  it("rejects a text file named .mp3", async () => {
    const file = path.join(dir, "fake.mp3");
    fs.writeFileSync(file, "this is not audio at all");
    await assert.rejects(
      probeFile(file),
      (error) =>
        error instanceof UnsupportedFormatError &&
        (error as UnsupportedFormatError).code === "unsupported_format",
    );
  });
});

describe("createMediaStorage", () => {
  it("publishes, then removes a track", async () => {
    const storage = createMediaStorage(path.join(dir, "data"));
    const incoming = storage.incomingDir("imp1");
    assert.ok(fs.statSync(incoming).isDirectory());
    const file = path.join(incoming, "upload.wav");
    writeWav(file, 1);
    await storage.publish("imp1", "t1", file, "wav", { data: Buffer.from("img"), ext: "png" });
    assert.ok(fs.existsSync(storage.originalPath("t1", "wav")));
    assert.equal(fs.readFileSync(storage.coverPath("t1", "png"), "utf8"), "img");
    assert.equal(fs.existsSync(incoming), false);
    await storage.removeTrack("t1");
    assert.equal(fs.existsSync(path.dirname(storage.originalPath("t1", "wav"))), false);
  });

  it("publishes without a cover and removes incoming", async () => {
    const storage = createMediaStorage(path.join(dir, "data2"));
    const file = path.join(storage.incomingDir("imp2"), "u.wav");
    writeWav(file, 1);
    await storage.publish("imp2", "t2", file, "wav", null);
    assert.ok(fs.existsSync(storage.originalPath("t2", "wav")));
    assert.equal(fs.existsSync(storage.coverPath("t2", "jpg")), false);
  });

  it("validates the cover extension before any side effect", async () => {
    const storage = createMediaStorage(path.join(dir, "data3"));
    const file = path.join(storage.incomingDir("imp3"), "u.wav");
    writeWav(file, 1);
    const bad = { data: Buffer.from("x"), ext: "../../x" as "png" };
    await assert.rejects(storage.publish("imp3", "t3", file, "wav", bad), /invalid extension/);
    assert.equal(fs.existsSync(path.dirname(storage.originalPath("t3", "wav"))), false);
    assert.ok(fs.existsSync(file), "source untouched");
  });

  it("removes the media dir when the cover write fails after the rename", async () => {
    const storage = createMediaStorage(path.join(dir, "data5"));
    const file = path.join(storage.incomingDir("imp5"), "u.wav");
    writeWav(file, 1);
    // A directory where the cover file goes makes writeFile fail after the rename.
    const mediaDir = path.dirname(storage.originalPath("t5", "wav"));
    fs.mkdirSync(storage.coverPath("t5", "png"), { recursive: true });
    await assert.rejects(
      storage.publish("imp5", "t5", file, "wav", { data: Buffer.from("x"), ext: "png" }),
      (error) => (error as NodeJS.ErrnoException).code === "EISDIR",
    );
    // The renamed original is removed with the media dir (incoming was already consumed).
    assert.equal(fs.existsSync(mediaDir), false);
    assert.equal(fs.existsSync(file), false);
  });

  it("refuses a source outside the incoming directory", async () => {
    const storage = createMediaStorage(path.join(dir, "data6"));
    storage.incomingDir("imp6");
    const outside = path.join(dir, "outside.wav");
    writeWav(outside, 1);
    await assert.rejects(
      storage.publish("imp6", "t6", outside, "wav", null),
      /file outside incoming directory/,
    );
    assert.ok(fs.existsSync(outside));
    assert.equal(fs.existsSync(path.dirname(storage.originalPath("t6", "wav"))), false);
  });

  it("rejects unsafe ids", async () => {
    const storage = createMediaStorage(path.join(dir, "data4"));
    for (const bad of ["", "..", "a/b", "../x"]) {
      assert.throws(() => storage.incomingDir(bad), /invalid id/);
      assert.throws(() => storage.originalPath(bad, "wav"), /invalid id/);
      await assert.rejects(storage.removeTrack(bad), /invalid id/);
      await assert.rejects(storage.removeIncoming(bad), /invalid id/);
    }
  });
});
