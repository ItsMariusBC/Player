import type { DatabaseSync } from "node:sqlite";
import { findTrackBySha, insertTrack } from "../catalog/tracks.ts";
import type { TrackRecord } from "../catalog/types.ts";
import { probeFile, UnsupportedFormatError, type ProbeResult } from "./probe.ts";
import type { MediaStorage } from "./storage.ts";

export type IngestResult =
  | { kind: "ready"; track: TrackRecord }
  | { kind: "duplicate"; trackId: string }
  | { kind: "unsupported" };

export interface IngestInput {
  db: DatabaseSync;
  storage: MediaStorage;
  importId: string;
  /** A file inside storage.incomingDir(importId). */
  file: string;
  /** Explicit values win over the tags. */
  title?: string;
  artist?: string;
  /** Used when neither an explicit title nor a tag exists. */
  fallbackTitle?: string;
  folderId?: string | null;
  /** Explicit cover wins over the embedded one. */
  cover?: ProbeResult["cover"];
  now: Date;
}

/**
 * The one pipeline shared by the admin queue and the migration script:
 * probe, dedupe by sha256, publish the file, insert the row. Unsupported files and duplicates
 * clean their incoming directory; unexpected errors are thrown and left to the caller.
 */
export async function ingestFile(input: IngestInput): Promise<IngestResult> {
  const { db, storage, importId, file, now } = input;
  let probe: ProbeResult;
  try {
    probe = await probeFile(file);
  } catch (error) {
    if (error instanceof UnsupportedFormatError) {
      await storage.removeIncoming(importId);
      return { kind: "unsupported" };
    }
    throw error;
  }
  const existing = findTrackBySha(db, probe.sha256);
  if (existing) {
    await storage.removeIncoming(importId);
    return { kind: "duplicate", trackId: existing.id };
  }
  const cover = input.cover ?? probe.cover;
  const trackId = crypto.randomUUID();
  await storage.publish(importId, trackId, file, probe.format, cover);
  try {
    const track = insertTrack(
      db,
      {
        id: trackId,
        folderId: input.folderId ?? null,
        title: input.title ?? probe.title ?? input.fallbackTitle ?? "Untitled",
        artist: input.artist ?? probe.artist ?? "",
        album: probe.album ?? "",
        durationMs: probe.durationMs,
        format: probe.format,
        sizeBytes: probe.sizeBytes,
        sha256: probe.sha256,
        coverExt: cover?.ext ?? null,
        status: "ready",
      },
      now,
    );
    return { kind: "ready", track };
  } catch (error) {
    await storage.removeTrack(trackId);
    throw error;
  }
}
