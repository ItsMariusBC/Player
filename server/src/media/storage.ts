import { mkdirSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AudioFormat, ProbeResult } from "./probe.ts";

export type CoverExt = "jpg" | "png" | "webp";

export interface MediaStorage {
  incomingDir(importId: string): string;
  removeIncoming(importId: string): Promise<void>;
  /** Names of the directories under incoming/ (empty when none exists yet). */
  listIncoming(): Promise<string[]>;
  /** Names of the directories under media/ (empty when none exists yet). */
  listMedia(): Promise<string[]>;
  publish(
    importId: string,
    trackId: string,
    file: string,
    ext: AudioFormat,
    cover: ProbeResult["cover"],
  ): Promise<void>;
  originalPath(trackId: string, ext: AudioFormat): string;
  coverPath(trackId: string, ext: CoverExt): string;
  /** Writes the cover and removes a previous cover stored with another extension. */
  writeCover(trackId: string, data: Buffer, ext: CoverExt): Promise<void>;
  /** Moves a file of the track directory into place as the cover (other covers are kept). */
  replaceCover(trackId: string, file: string, ext: CoverExt): Promise<void>;
  /** Removes the covers stored with an extension other than keep. */
  removeOtherCovers(trackId: string, keep: CoverExt): Promise<void>;
  /** A fresh hidden path inside the track directory, for writes moved into place by rename. */
  scratchPath(trackId: string): string;
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

  const removeOtherCovers = async (trackId: string, keep: CoverExt) => {
    for (const ext of COVER_EXTS) {
      if (ext !== keep) await rm(storage.coverPath(trackId, ext as CoverExt), { force: true });
    }
  };

  const storage: MediaStorage = {
    incomingDir(importId) {
      const dir = path.join(incomingRoot, safeId(importId));
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    async removeIncoming(importId) {
      await rm(path.join(incomingRoot, safeId(importId)), { recursive: true, force: true });
    },
    async listIncoming() {
      try {
        const entries = await readdir(incomingRoot, { withFileTypes: true });
        return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
    async listMedia() {
      try {
        const entries = await readdir(mediaRoot, { withFileTypes: true });
        return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
    originalPath(trackId, ext) {
      return path.join(trackDir(trackId), `original.${safeExt(ext, AUDIO_EXTS)}`);
    },
    coverPath(trackId, ext) {
      return path.join(trackDir(trackId), `cover.${safeExt(ext, COVER_EXTS)}`);
    },
    async writeCover(trackId, data, ext) {
      await writeFile(storage.coverPath(trackId, ext), data);
      await removeOtherCovers(trackId, ext);
    },
    async replaceCover(trackId, file, ext) {
      const relative = path.relative(trackDir(trackId), path.resolve(file));
      if (relative === "" || relative.includes(path.sep) || relative.startsWith("..")) {
        throw new Error("file outside track directory");
      }
      await rename(file, storage.coverPath(trackId, ext));
    },
    removeOtherCovers: (trackId, keep) => removeOtherCovers(trackId, keep),
    scratchPath(trackId) {
      return path.join(trackDir(trackId), `.tmp-${crypto.randomUUID()}`);
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
