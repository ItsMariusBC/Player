import type { DatabaseSync } from "node:sqlite";
import { findTrackBySha, insertTrack } from "../catalog/tracks.ts";
import type { TrackRecord } from "../catalog/types.ts";
import type { Loudness } from "./loudness.ts";
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
  /** Lazy: called only once the file is known to be new, so duplicates have no side effects. */
  folderId?: () => string | null;
  /** Lazy, same rule. An explicit cover (non-null) wins over the embedded one. */
  cover?: () => Promise<ProbeResult["cover"]>;
  /** Loudness measurement; injected so tests never run ffmpeg. Omitted: not measured. Must not throw. */
  measure?: (file: string) => Promise<Loudness | null>;
  now: Date;
}

/**
 * The one pipeline shared by the admin queue and the migration script:
 * probe, measure loudness, dedupe by sha256, publish the file, insert the row. Unsupported files and duplicates
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
  let loudness: Loudness | null = null;
  try {
    loudness = (await input.measure?.(file)) ?? null;
  } catch {
    // A failed measurement never fails the import; the backfill can retry later.
  }
  const cover = (await input.cover?.()) ?? probe.cover;
  const folderId = input.folderId?.() ?? null;
  const trackId = crypto.randomUUID();
  await storage.publish(importId, trackId, file, probe.format, cover);
  try {
    const track = insertTrack(
      db,
      {
        id: trackId,
        folderId,
        title: input.title ?? probe.title ?? input.fallbackTitle ?? "Untitled",
        artist: input.artist ?? probe.artist ?? "",
        album: probe.album ?? "",
        durationMs: probe.durationMs,
        format: probe.format,
        sizeBytes: probe.sizeBytes,
        sha256: probe.sha256,
        coverExt: cover?.ext ?? null,
        status: "ready",
        loudnessLufs: loudness?.lufs ?? null,
        truePeakDbtp: loudness?.truePeakDbtp ?? null,
      },
      now,
    );
    return { kind: "ready", track };
  } catch (error) {
    await storage.removeTrack(trackId);
    // Another process (for example the migration script) inserted the same file meanwhile.
    if (
      (error as { code?: unknown }).code === "ERR_SQLITE_ERROR" &&
      /UNIQUE/i.test(String((error as Error).message))
    ) {
      const winner = findTrackBySha(db, probe.sha256);
      if (winner) {
        await storage.removeIncoming(importId);
        return { kind: "duplicate", trackId: winner.id };
      }
    }
    throw error;
  }
}
