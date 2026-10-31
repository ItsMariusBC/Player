import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { measureLoudness, parseEbur128, resetUnavailableLog } from "../src/media/loudness.ts";
import type { RunFfmpeg } from "../src/media/loudness.ts";

const FIXTURE = fs.readFileSync(new URL("./fixtures/ebur128-ffmpeg8.txt", import.meta.url), "utf8");
const FIXTURE_LUFS = -23.8;

describe("parseEbur128", () => {
  it("reads the summary of a real ffmpeg 8 run", () => {
    const result = parseEbur128(FIXTURE);
    assert.ok(result);
    assert.ok(Math.abs(result.lufs - FIXTURE_LUFS) < 0.05);
    assert.ok(result.truePeakDbtp !== null && Math.abs(result.truePeakDbtp - -20.1) < 0.05);
  });

  it("returns null for -inf (silence)", () => {
    const silent =
      "  Integrated loudness:\n    I:         -inf LUFS\n  True peak:\n    Peak:      -inf dBFS\n";
    assert.equal(parseEbur128(silent), null);
  });

  it("keeps a null peak when only the loudness is readable", () => {
    assert.deepEqual(parseEbur128("    I:         -14.2 LUFS\n"), {
      lufs: -14.2,
      truePeakDbtp: null,
    });
  });

  it("returns null for garbage or empty input", () => {
    assert.equal(parseEbur128("no summary here"), null);
    assert.equal(parseEbur128(""), null);
  });
});

function failing(props: Record<string, unknown>): RunFfmpeg {
  return async () => {
    throw Object.assign(new Error("boom with secret output"), props);
  };
}

describe("measureLoudness", () => {
  it("returns the parsed values and passes the spec arguments", async () => {
    let seen: string[] = [];
    const run: RunFfmpeg = async (_file, args) => {
      seen = args;
      return { stderr: FIXTURE };
    };
    const result = await measureLoudness("/x/a.wav", { ffmpegPath: "ffmpeg", run });
    assert.ok(result && Math.abs(result.lufs - FIXTURE_LUFS) < 0.05);
    assert.deepEqual(seen, [
      "-nostdin",
      "-hide_banner",
      "-i",
      "/x/a.wav",
      "-af",
      "ebur128=peak=true:framelog=quiet",
      "-f",
      "null",
      "-",
    ]);
  });

  it("returns null on unparsable output", async () => {
    const run: RunFfmpeg = async () => ({ stderr: "nothing" });
    assert.equal(await measureLoudness("/x/a.wav", { ffmpegPath: "ffmpeg", run }), null);
  });

  it("returns null on ENOENT and logs loudness.unavailable once", async () => {
    resetUnavailableLog();
    const events: string[] = [];
    const log = (event: string) => events.push(event);
    const run = failing({ code: "ENOENT" });
    assert.equal(await measureLoudness("/x/a.wav", { ffmpegPath: "nope", run, log }), null);
    assert.equal(await measureLoudness("/x/a.wav", { ffmpegPath: "nope", run, log }), null);
    assert.deepEqual(events, ["loudness.unavailable"]);
  });

  it("returns null on timeout and logs name and code only", async () => {
    const logs: { event: string; data?: Record<string, unknown> }[] = [];
    const log = (event: string, data?: Record<string, unknown>) => logs.push({ event, data });
    const run = failing({ killed: true, signal: "SIGTERM", code: null });
    assert.equal(await measureLoudness("/x/a.wav", { ffmpegPath: "ffmpeg", run, log }), null);
    assert.equal(logs[0]?.event, "loudness.failed");
    assert.ok(!JSON.stringify(logs).includes("secret"));
  });

  it("returns null on exit code 1", async () => {
    const logs: { event: string; data?: Record<string, unknown> }[] = [];
    const log = (event: string, data?: Record<string, unknown>) => logs.push({ event, data });
    assert.equal(
      await measureLoudness("/x/a.wav", { ffmpegPath: "ffmpeg", run: failing({ code: 1 }), log }),
      null,
    );
    assert.deepEqual(logs[0], { event: "loudness.failed", data: { name: "Error", code: 1 } });
  });
});

function ffmpegBinary(): string | null {
  const candidate = process.env.FFMPEG_PATH || "ffmpeg";
  try {
    execFileSync(candidate, ["-version"], { stdio: "ignore" });
    return candidate;
  } catch {
    return null;
  }
}

/** 3 s mono 44.1 kHz 16-bit sine at -20 dBFS peak. */
function writeTone(file: string): void {
  const rate = 44_100;
  const n = rate * 3;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(32767 * 0.1 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

describe("measureLoudness with a real ffmpeg", () => {
  it("measures a -20 dBFS tone", async (t) => {
    const ffmpegPath = ffmpegBinary();
    if (!ffmpegPath) {
      t.skip("ffmpeg not found");
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "player-loudness-"));
    try {
      const file = path.join(dir, "tone.wav");
      writeTone(file);
      const result = await measureLoudness(file, { ffmpegPath });
      assert.ok(result);
      assert.ok(Math.abs(result.lufs - FIXTURE_LUFS) <= 1.5, `lufs ${result.lufs}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
