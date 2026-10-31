import { execFile } from "node:child_process";

export interface Loudness {
  lufs: number;
  truePeakDbtp: number | null;
}

export interface RunResult {
  stderr: string;
}

export type RunFfmpeg = (
  file: string,
  args: string[],
  opts: { timeoutMs: number },
) => Promise<RunResult>;

export interface MeasureOptions {
  ffmpegPath: string;
  timeoutMs?: number;
  run?: RunFfmpeg;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 8 * 1024 * 1024;
const LUFS_RE = /^\s*I:\s*(-?\d+(?:\.\d+)?|-?inf)\s*LUFS\s*$/gim;
const PEAK_RE = /^\s*Peak:\s*(-?\d+(?:\.\d+)?|-?inf)\s*dBFS\s*$/gim;

function lastMatch(re: RegExp, text: string): string | null {
  let last: string | null = null;
  for (const m of text.matchAll(re)) last = m[1] ?? null;
  return last;
}

/** Reads the final EBU R128 summary of `ffmpeg -af ebur128=peak=true`. Null if absent, `-inf` or unreadable. */
export function parseEbur128(stderr: string): Loudness | null {
  const integrated = lastMatch(LUFS_RE, stderr);
  if (integrated === null) return null;
  const lufs = Number(integrated);
  if (!Number.isFinite(lufs)) return null;
  const peakRaw = lastMatch(PEAK_RE, stderr);
  const peak = peakRaw === null ? Number.NaN : Number(peakRaw);
  return { lufs, truePeakDbtp: Number.isFinite(peak) ? peak : null };
}

const defaultRun =
  (ffmpegPath: string): RunFfmpeg =>
  (_file, args, { timeoutMs }) =>
    new Promise((resolve, reject) => {
      execFile(
        ffmpegPath,
        args,
        { timeout: timeoutMs, maxBuffer: MAX_BUFFER, windowsHide: true, encoding: "utf8" },
        (error, _stdout, stderr) => {
          if (error) reject(error);
          else resolve({ stderr });
        },
      );
    });

let unavailableLogged = false;

/** Measures integrated loudness and true peak. Never throws: null when unavailable, failed or unreadable. */
export async function measureLoudness(
  path: string,
  opts: MeasureOptions,
): Promise<Loudness | null> {
  const run = opts.run ?? defaultRun(opts.ffmpegPath);
  const args = [
    "-nostdin",
    "-hide_banner",
    "-i",
    path,
    "-af",
    "ebur128=peak=true:framelog=quiet",
    "-f",
    "null",
    "-",
  ];
  try {
    const { stderr } = await run(path, args, { timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS });
    return parseEbur128(stderr);
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { killed?: boolean };
    if (err.code === "ENOENT") {
      if (!unavailableLogged) {
        unavailableLogged = true;
        opts.log?.("loudness.unavailable", { ffmpegPath: opts.ffmpegPath });
      }
      return null;
    }
    opts.log?.("loudness.failed", { name: err.name, code: err.code ?? null });
    return null;
  }
}

/** Test hook: lets each test observe the once-per-process log. */
export function resetUnavailableLog(): void {
  unavailableLogged = false;
}
