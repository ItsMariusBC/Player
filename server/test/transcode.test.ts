import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  convertWavToFlac,
  encodeAac,
  resetUnavailableLog,
  type RunTranscode,
} from "../src/media/transcode.ts";

beforeEach(() => resetUnavailableLog());

function failing(props: Record<string, unknown>): RunTranscode {
  return async () => {
    throw Object.assign(new Error("boom"), props);
  };
}

describe("encodeAac", () => {
  it("runs ffmpeg with the exact arguments and the default 10 minute timeout", async () => {
    const calls: { args: string[]; timeoutMs: number }[] = [];
    const ok = await encodeAac("/in/original.flac", "/out/.tmp-1", {
      ffmpegPath: "ffmpeg",
      run: async (args, { timeoutMs }) => {
        calls.push({ args, timeoutMs });
      },
    });
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, [
      "-nostdin",
      "-hide_banner",
      "-y",
      "-i",
      "/in/original.flac",
      "-vn",
      "-map_metadata",
      "-1",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      "/out/.tmp-1",
    ]);
    assert.equal(calls[0]?.timeoutMs, 600_000);
  });

  it("honours a custom timeout", async () => {
    let seen = 0;
    await encodeAac("a", "b", {
      ffmpegPath: "ffmpeg",
      timeoutMs: 5,
      run: async (_args, { timeoutMs }) => {
        seen = timeoutMs;
      },
    });
    assert.equal(seen, 5);
  });

  it("logs once per process when ffmpeg is missing", async () => {
    const events: string[] = [];
    const opts = {
      ffmpegPath: "nope",
      run: failing({ code: "ENOENT" }),
      log: (event: string) => events.push(event),
    };
    assert.equal(await encodeAac("a", "b", opts), false);
    assert.equal(await convertWavToFlac("a", "b", opts), false);
    assert.deepEqual(events, ["transcode.unavailable"]);
  });

  it("returns false and logs the failure on a non-zero exit", async () => {
    const events: { event: string; data?: Record<string, unknown> }[] = [];
    const ok = await encodeAac("a", "b", {
      ffmpegPath: "ffmpeg",
      run: failing({ code: 1 }),
      log: (event, data) => events.push({ event, data }),
    });
    assert.equal(ok, false);
    assert.equal(events[0]?.event, "transcode.failed");
    assert.equal(events[0]?.data?.kind, "aac");
    assert.equal(events[0]?.data?.code, 1);
  });

  it("returns false on a timeout", async () => {
    const ok = await encodeAac("a", "b", {
      ffmpegPath: "ffmpeg",
      run: failing({ killed: true, signal: "SIGTERM", code: null }),
    });
    assert.equal(ok, false);
  });
});

describe("convertWavToFlac", () => {
  it("runs ffmpeg with the exact arguments", async () => {
    let seen: string[] = [];
    const ok = await convertWavToFlac("/in/original.wav", "/out/converted.flac", {
      ffmpegPath: "ffmpeg",
      run: async (args) => {
        seen = args;
      },
    });
    assert.equal(ok, true);
    assert.deepEqual(seen, [
      "-nostdin",
      "-hide_banner",
      "-y",
      "-i",
      "/in/original.wav",
      "-vn",
      "-map_metadata",
      "0",
      "-c:a",
      "flac",
      "-compression_level",
      "5",
      "-f",
      "flac",
      "/out/converted.flac",
    ]);
  });

  it("returns false and logs kind flac on failure", async () => {
    const events: { event: string; data?: Record<string, unknown> }[] = [];
    const ok = await convertWavToFlac("a", "b", {
      ffmpegPath: "ffmpeg",
      run: failing({ code: 2 }),
      log: (event, data) => events.push({ event, data }),
    });
    assert.equal(ok, false);
    assert.equal(events[0]?.data?.kind, "flac");
  });
});
