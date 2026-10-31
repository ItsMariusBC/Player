import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { parseFile } from "music-metadata";
import { readHead, sniffFormat } from "../src/media/probe.ts";
import { convertWavToFlac, encodeAac } from "../src/media/transcode.ts";
import { writeWav } from "./fixtures.ts";

const ffmpegPresent = await new Promise<boolean>((resolve) =>
  execFile("ffmpeg", ["-version"], (error) => resolve(!error)),
);

describe("real ffmpeg", { skip: ffmpegPresent ? false : "ffmpeg not installed" }, () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "transcode-real-"));
    writeWav(path.join(dir, "in.wav"), 1);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("converts a WAV to a FLAC that is sniffed as flac", async () => {
    const dest = path.join(dir, "out.flac");
    assert.equal(
      await convertWavToFlac(path.join(dir, "in.wav"), dest, { ffmpegPath: "ffmpeg" }),
      true,
    );
    assert.equal(sniffFormat(await readHead(dest)), "flac");
  });

  it("encodes an AAC in an MP4 container that music-metadata reads", async () => {
    const dest = path.join(dir, "out.m4a");
    assert.equal(await encodeAac(path.join(dir, "in.wav"), dest, { ffmpegPath: "ffmpeg" }), true);
    const meta = await parseFile(dest);
    assert.match(meta.format.container ?? "", /mp4|m4a/i);
    assert.match(meta.format.codec ?? "", /aac/i);
  });
});
