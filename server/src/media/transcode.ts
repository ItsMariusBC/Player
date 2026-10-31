import { execFile } from "node:child_process";

export interface TranscodeOptions {
  ffmpegPath: string;
  timeoutMs?: number;
  run?: RunTranscode;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

export type RunTranscode = (args: string[], opts: { timeoutMs: number }) => Promise<void>;

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MAX_BUFFER = 8 * 1024 * 1024;

const defaultRun =
  (ffmpegPath: string): RunTranscode =>
  (args, { timeoutMs }) =>
    new Promise((resolve, reject) => {
      execFile(
        ffmpegPath,
        args,
        { timeout: timeoutMs, maxBuffer: MAX_BUFFER, windowsHide: true, encoding: "utf8" },
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    });

let unavailableLogged = false;

async function transcode(
  kind: "aac" | "flac",
  args: string[],
  opts: TranscodeOptions,
): Promise<boolean> {
  const run = opts.run ?? defaultRun(opts.ffmpegPath);
  try {
    await run(args, { timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS });
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      if (!unavailableLogged) {
        unavailableLogged = true;
        opts.log?.("transcode.unavailable", { ffmpegPath: opts.ffmpegPath });
      }
      return false;
    }
    opts.log?.("transcode.failed", { kind, name: err.name, code: err.code ?? null });
    return false;
  }
}

/** Encodes the light AAC variant (192 kb/s, no metadata). Never throws: false on any failure. */
export function encodeAac(src: string, dest: string, opts: TranscodeOptions): Promise<boolean> {
  return transcode(
    "aac",
    [
      "-nostdin",
      "-hide_banner",
      "-y",
      "-i",
      src,
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
      dest,
    ],
    opts,
  );
}

/** Lossless WAV to FLAC conversion. Never throws: false on any failure. */
export function convertWavToFlac(
  src: string,
  dest: string,
  opts: TranscodeOptions,
): Promise<boolean> {
  return transcode(
    "flac",
    [
      "-nostdin",
      "-hide_banner",
      "-y",
      "-i",
      src,
      "-vn",
      "-map_metadata",
      "0",
      "-c:a",
      "flac",
      "-compression_level",
      "5",
      "-f",
      "flac",
      dest,
    ],
    opts,
  );
}

/** Test hook: lets each test observe the once-per-process log. */
export function resetUnavailableLog(): void {
  unavailableLogged = false;
}
