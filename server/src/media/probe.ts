import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { parseFile } from "music-metadata";

export type AudioFormat = "flac" | "mp3" | "wav";

export class UnsupportedFormatError extends Error {
  readonly code = "unsupported_format";
  constructor() {
    super("Unsupported audio format");
    this.name = "UnsupportedFormatError";
  }
}

export interface ProbeResult {
  format: AudioFormat;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  cover: { data: Buffer; ext: "jpg" | "png" | "webp" } | null;
  sha256: string;
  sizeBytes: number;
}

const COVER_EXT: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Detects the format from the first bytes; the file extension is never trusted. */
export function sniffFormat(head: Buffer): AudioFormat | null {
  if (head.length >= 4 && head.toString("latin1", 0, 4) === "fLaC") return "flac";
  if (head.length >= 3 && head.toString("latin1", 0, 3) === "ID3") return "mp3";
  if (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) return "mp3";
  if (
    head.length >= 12 &&
    head.toString("latin1", 0, 4) === "RIFF" &&
    head.toString("latin1", 8, 12) === "WAVE"
  ) {
    return "wav";
  }
  return null;
}

async function readHead(path: string): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, 12, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Streamed SHA-256 of a file, hex encoded. */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

type Tags = Pick<ProbeResult, "title" | "artist" | "album" | "durationMs" | "cover">;

async function readTags(path: string): Promise<Tags> {
  const empty: Tags = { title: null, artist: null, album: null, durationMs: null, cover: null };
  try {
    const metadata = await parseFile(path);
    const picture = metadata.common.picture?.[0];
    const ext = picture ? COVER_EXT[picture.format.toLowerCase()] : undefined;
    const duration = metadata.format.duration;
    return {
      title: metadata.common.title ?? null,
      artist: metadata.common.artist ?? null,
      album: metadata.common.album ?? null,
      durationMs: typeof duration === "number" ? Math.round(duration * 1000) : null,
      cover: picture && ext ? { data: Buffer.from(picture.data), ext } : null,
    };
  } catch {
    // Unreadable tags are not fatal: the file is still a recognised audio container.
    return empty;
  }
}

export async function probeFile(path: string): Promise<ProbeResult> {
  const format = sniffFormat(await readHead(path));
  if (!format) throw new UnsupportedFormatError();
  const [tags, sha256, info] = await Promise.all([readTags(path), hashFile(path), stat(path)]);
  return { format, ...tags, sha256, sizeBytes: info.size };
}
