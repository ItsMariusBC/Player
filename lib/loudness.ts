// lib/loudness.ts
// Pure helpers for loudness normalisation (ReplayGain style).

export const GAIN_MIN_DB = -20;
export const GAIN_MAX_DB = 12;
/** Highest true peak allowed after the gain, in dBTP. */
export const PEAK_CEILING_DBTP = -1;

export interface LoudnessInput {
  lufs: number | null;
  truePeakDbtp: number | null;
}

/**
 * Gain in dB bringing a track to `target` LUFS: clamped to [-20, +12], then reduced
 * so that the true peak stays at or under -1 dBTP when it is known.
 * 0 when the loudness is unknown.
 */
export function replayGain(input: LoudnessInput, target = -14): number {
  const { lufs, truePeakDbtp } = input;
  if (lufs === null || !Number.isFinite(lufs)) return 0;
  let gain = Math.max(GAIN_MIN_DB, Math.min(GAIN_MAX_DB, target - lufs));
  if (truePeakDbtp !== null && Number.isFinite(truePeakDbtp)) {
    gain = Math.min(gain, PEAK_CEILING_DBTP - truePeakDbtp);
  }
  return gain;
}

export const dbToLinear = (db: number): number => 10 ** (db / 20);
