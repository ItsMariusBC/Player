import { mkdirSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AudioFormat, ProbeResult } from "./probe.ts";

type CoverExt = "jpg" | "png" | "webp";

export interface MediaStorage {
  incomingDir(importId: string): string;
  removeIncoming(importId: string): Promise<void>;
  publish(
    importId: string,
    trackId: string,
    file: string,
    ext: AudioFormat,
    cover: ProbeResult["cover"],
  ): Promise<void>;
  originalPath(trackId: string, ext: AudioFormat): string;
  coverPath(trackId: string, ext: CoverExt): string;
  writeCover(trackId: string, data: Buffer, ext: CoverExt): Promise<void>;
  removeTrack(trackId: string): Promise<void>;
}

const AUDIO_EXTS: readonly string[] = ["flac", "mp3", "wav"];
const COVER_EXTS: readonly string[] = ["jpg", "png", "webp"];

function safeId(id: string): string {
  if (id === "" || id === "." || id === ".." || id.includes("/") || id.includes("\\")) {
    throw new Error("invalid id");
  }
  if (id.includes("\0")) throw new Error("invalid id");
  return id;
}

function safeExt(ext: string, allowed: readonly string[]): string {
  if (!allowed.includes(ext)) throw new Error("invalid extension");
  return ext;
}

export function createMediaStorage(dataDir: string): MediaStorage {
  const mediaRoot = path.join(dataDir, "media");
  const incomingRoot = path.join(dataDir, "incoming");
  const trackDir = (trackId: string) => path.join(mediaRoot, safeId(trackId));

  const storage: MediaStorage = {
    incomingDir(importId) {
      const dir = path.join(incomingRoot, safeId(importId));
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    async removeIncoming(importId) {
      await rm(path.join(incomingRoot, safeId(importId)), { recursive: true, force: true });
    },
    originalPath(trackId, ext) {
      return path.join(trackDir(trackId), `original.${safeExt(ext, AUDIO_EXTS)}`);
    },
    coverPath(trackId, ext) {
      return path.join(trackDir(trackId), `cover.${safeExt(ext, COVER_EXTS)}`);
    },
    async writeCover(trackId, data, ext) {
      await writeFile(storage.coverPath(trackId, ext), data);
    },
    async removeTrack(trackId) {
      await rm(trackDir(trackId), { recursive: true, force: true });
    },
    async publish(importId, trackId, file, ext, cover) {
      const relative = path.relative(
        path.resolve(incomingRoot, safeId(importId)),
        path.resolve(file),
      );
      if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("file outside incoming directory");
      }
      const target = storage.originalPath(trackId, ext);
      if (cover) storage.coverPath(trackId, cover.ext);
      await mkdir(trackDir(trackId), { recursive: true });
      try {
        await rename(file, target);
        if (cover) await storage.writeCover(trackId, cover.data, cover.ext);
      } catch (error) {
        await storage.removeTrack(trackId);
        throw error;
      }
      await storage.removeIncoming(importId);
    },
  };
  return storage;
}
