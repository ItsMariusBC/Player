import { describe, expect, test } from "bun:test";
import { dbToLinear, replayGain } from "../../lib/loudness";

describe("replayGain", () => {
  test("target minus loudness", () => {
    expect(replayGain({ lufs: -20, truePeakDbtp: -10 })).toBe(6);
    expect(replayGain({ lufs: -9, truePeakDbtp: -10 })).toBe(-5);
  });
  test("custom target", () => {
    expect(replayGain({ lufs: -20, truePeakDbtp: null }, -23)).toBe(-3);
  });
  test("clamped to [-20, +12]", () => {
    expect(replayGain({ lufs: -60, truePeakDbtp: null })).toBe(12);
    expect(replayGain({ lufs: 20, truePeakDbtp: null })).toBe(-20);
  });
  test("peak limits the gain to keep -1 dBTP", () => {
    expect(replayGain({ lufs: -24, truePeakDbtp: -4 })).toBe(3);
    expect(replayGain({ lufs: -24, truePeakDbtp: 0.5 })).toBe(-1.5);
  });
  test("unknown peak does not limit", () => {
    expect(replayGain({ lufs: -24, truePeakDbtp: null })).toBe(10);
  });
  test("null loudness gives 0 whatever the peak", () => {
    expect(replayGain({ lufs: null, truePeakDbtp: null })).toBe(0);
    expect(replayGain({ lufs: null, truePeakDbtp: -30 })).toBe(0);
  });
});

describe("dbToLinear", () => {
  test("conversion", () => {
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(20)).toBeCloseTo(10, 9);
    expect(dbToLinear(-6)).toBeCloseTo(0.501187, 5);
  });
});
