// The file-and-database sequence shared by the track routes (PATCH, cover upload) and the
// metadata apply route. Callers hold the track lock (createTrackLocks) around these calls.
import { copyFile, rename, rm, stat } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { getFolder } from "../catalog/folders.ts";
import { findTrackBySha, getTrack, moveTrack, updateTrack } from "../catalog/tracks.ts";
import { inTransaction } from "../catalog/tx.ts";
import type { TrackRecord } from "../catalog/types.ts";
import { hashFile } from "../media/probe.ts";
import type { CoverExt, MediaStorage } from "../media/storage.ts";
import { writeTags } from "../media/tags.ts";
import { recordAdminEvent, type AdminAction } from "./events.ts";

export interface TrackEditDeps {
  db: DatabaseSync;
  storage: MediaStorage;
  now: () => Date;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

export interface TrackPatch {
  title?: string;
  artist?: string;
  album?: string;
  folderId?: string | null;
  position?: number;
}

export interface EditEvent {
  userId: string;
  action: AdminAction;
  detail: Record<string, unknown>;
}

export type WithTrackLock = <T>(trackId: string, fn: () => Promise<T>) => Promise<T>;

export class TrackNotFound extends Error {}
export class UnknownFolder extends Error {}

const describe = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : "unknown";

/**
 * Serialises the file work on one track (tag rewrite, cover, delete, metadata apply). One
 * instance per app, shared by every route that touches a track's files.
 */
export function createTrackLocks(): WithTrackLock {
  const tails = new Map<string, Promise<unknown>>();
  return async function withLock<T>(trackId: string, fn: () => Promise<T>): Promise<T> {
    const previous = tails.get(trackId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => {});
    tails.set(trackId, tail);
    try {
      return await run;
    } finally {
      if (tails.get(trackId) === tail) tails.delete(trackId);
    }
  };
}

export function readyTrack(db: DatabaseSync, id: string): TrackRecord | null {
  const track = getTrack(db, id);
  return track && track.status === "ready" ? track : null;
}

/**
 * Rewrites the tags on a scratch copy and returns it with its sha256 and size, or null when
 * no tag could be written. The original is never touched here: the caller moves the copy
 * into place after the database commit, and removes it otherwise.
 */
async function tagCopy(deps: TrackEditDeps, track: TrackRecord, patch: TrackPatch) {
  if (track.format === "wav") return null;
  const tags = {
    title: patch.title ?? track.title,
    artist: patch.artist ?? track.artist,
    album: patch.album ?? track.album,
  };
  const copy = deps.storage.scratchPath(track.id);
  try {
    await copyFile(deps.storage.originalPath(track.id, track.format), copy);
    if (!(await writeTags(copy, track.format, tags, deps.log))) {
      await rm(copy, { force: true });
      return null;
    }
    const [sha256, info] = await Promise.all([hashFile(copy), stat(copy)]);
    return { copy, sha256, sizeBytes: info.size };
  } catch (error) {
    deps.log?.("tags.rewrite_failed", { trackId: track.id, error: describe(error) });
    await rm(copy, { force: true });
    return null;
  }
}

/**
 * Applies a patch to a ready track: tags written on a scratch copy (best effort), sha256
 * collision check, one transaction for the row, the move and the admin event (its detail
 * gets tagsWritten; no event when omitted, for callers that audit a whole batch), then the copy replaces the original. Throws TrackNotFound,
 * UnknownFolder, or the repository's catalog errors.
 */
export async function applyTrackPatch(
  deps: TrackEditDeps,
  trackId: string,
  patch: TrackPatch,
  event?: EditEvent,
): Promise<{ track: TrackRecord; tagsWritten: boolean }> {
  const { db, storage } = deps;
  const track = readyTrack(db, trackId);
  if (!track) throw new TrackNotFound();
  const touchesTags =
    patch.title !== undefined || patch.artist !== undefined || patch.album !== undefined;
  let tagged = touchesTags ? await tagCopy(deps, track, patch) : null;
  if (tagged) {
    const owner = findTrackBySha(db, tagged.sha256);
    if (owner && owner.id !== trackId) {
      // Another track already has these exact bytes: keep this file as it is.
      deps.log?.("tags.sha_collision", { trackId, otherId: owner.id });
      await rm(tagged.copy, { force: true });
      tagged = null;
    }
  }
  const tagsWritten = tagged !== null;
  const now = deps.now();
  let updated: TrackRecord;
  try {
    updated = inTransaction(db, () => {
      let result = updateTrack(
        db,
        trackId,
        {
          title: patch.title,
          artist: patch.artist,
          album: patch.album,
          ...(tagged ? { sha256: tagged.sha256, sizeBytes: tagged.sizeBytes } : {}),
        },
        now,
      );
      if (patch.folderId !== undefined || patch.position !== undefined) {
        // Checked again here: the folder may have been deleted while the tags were written.
        if (patch.folderId && !getFolder(db, patch.folderId)) throw new UnknownFolder();
        const folderId = patch.folderId === undefined ? result.folderId : patch.folderId;
        result = moveTrack(db, trackId, folderId, patch.position, now);
      }
      if (event) {
        recordAdminEvent(
          db,
          {
            userId: event.userId,
            action: event.action,
            trackId,
            detail: { ...event.detail, tagsWritten },
          },
          now,
        );
      }
      return result;
    });
  } catch (error) {
    if (tagged) await rm(tagged.copy, { force: true });
    throw error;
  }
  if (tagged) {
    try {
      await rename(tagged.copy, storage.originalPath(trackId, track.format));
    } catch (error) {
      // Same-directory rename: very unlikely, but the row now describes the tagged copy.
      deps.log?.("tags.replace_failed", { trackId, error: describe(error) });
      await rm(tagged.copy, { force: true });
    }
  }
  return { track: updated, tagsWritten };
}

/**
 * Moves an image already checked by signature (a file of the track directory) into place as
 * the cover, then records coverExt and the event; covers with another extension are removed
 * after the commit, so a failed database step leaves the previous cover in use. The caller
 * removes the source file if it is still there.
 */
export async function applyCoverFile(
  deps: TrackEditDeps,
  trackId: string,
  file: string,
  ext: CoverExt,
  event: EditEvent,
): Promise<TrackRecord> {
  const { db, storage } = deps;
  const current = readyTrack(db, trackId);
  if (!current) throw new TrackNotFound();
  const previous = current.coverExt;
  // A cover with the same extension is overwritten here; another one survives until the commit.
  await storage.replaceCover(trackId, file, ext);
  const now = deps.now();
  let updated: TrackRecord;
  try {
    updated = inTransaction(db, () => {
      const result = updateTrack(db, trackId, { coverExt: ext }, now);
      recordAdminEvent(
        db,
        { userId: event.userId, action: event.action, trackId, detail: event.detail },
        now,
      );
      return result;
    });
  } catch (error) {
    if (previous !== ext) await rm(storage.coverPath(trackId, ext), { force: true });
    throw error;
  }
  await storage.removeOtherCovers(trackId, ext);
  return updated;
}
