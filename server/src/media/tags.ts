import { createRequire } from "node:module";
import NodeID3 from "node-id3";
import type { AudioFormat } from "./probe.ts";

export interface TagValues {
  title: string;
  artist: string;
  album: string;
}

interface MetaflacFile {
  removeTag(name: string): void;
  setTag(field: string): void;
  save(): void;
}

// metaflac-js is CommonJS without type declarations.
const require = createRequire(import.meta.url);
const Metaflac = require("metaflac-js") as new (file: string) => MetaflacFile;

async function writeMp3(path: string, tags: TagValues): Promise<boolean> {
  // update() merges into the existing ID3 frames instead of replacing the whole tag.
  // The promise rejects on failure; its resolved value is not reliable (undefined in 0.2.9).
  await NodeID3.Promise.update({ title: tags.title, artist: tags.artist, album: tags.album }, path);
  return true;
}

function writeFlac(path: string, tags: TagValues): boolean {
  const flac = new Metaflac(path);
  for (const [name, value] of [
    ["TITLE", tags.title],
    ["ARTIST", tags.artist],
    ["ALBUM", tags.album],
  ] as const) {
    flac.removeTag(name);
    if (value !== "") flac.setTag(`${name}=${value}`);
  }
  flac.save();
  return true;
}

/**
 * Best effort: rewrites title, artist and album in the audio file. Returns false when the
 * format has no supported tag writer (WAV) or the library fails; the file is then unchanged
 * for WAV and unspecified for a failed write (callers work on a copy).
 */
export async function writeTags(
  path: string,
  format: AudioFormat,
  tags: TagValues,
  log?: (event: string, data?: Record<string, unknown>) => void,
): Promise<boolean> {
  try {
    if (format === "mp3") return await writeMp3(path, tags);
    if (format === "flac") return writeFlac(path, tags);
    return false;
  } catch (error) {
    log?.("tags.write_failed", {
      format,
      error: error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
    });
    return false;
  }
}
