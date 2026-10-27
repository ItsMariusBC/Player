import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { copyFile, open, rename, rm, stat } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { recordAdminEvent } from "../admin/events.ts";
import { requireAdmin, type AuthEnv } from "../auth/middleware.ts";
import { getFolder } from "../catalog/folders.ts";
import {
  deleteTrack,
  findTrackBySha,
  getTrack,
  moveTrack,
  toTrackDto,
  updateTrack,
} from "../catalog/tracks.ts";
import { inTransaction } from "../catalog/tx.ts";
import type { TrackRecord } from "../catalog/types.ts";
import { jsonError, readJsonObject } from "../http.ts";
import { hashFile } from "../media/probe.ts";
import type { CoverExt, MediaStorage } from "../media/storage.ts";
import { writeTags } from "../media/tags.ts";
import {
  catalogErrorResponse,
  isNullableId,
  isPosition,
  onlyKeys,
  optionalText,
  requiredText,
} from "./catalog-errors.ts";
import { receive } from "./multipart.ts";

export const MAX_COVER_BYTES = 5 * 1024 * 1024;

/** Detects the image type from its signature; the client's filename and type are ignored. */
export function sniffImage(head: Buffer): CoverExt | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length >= 8 && png.every((byte, i) => head[i] === byte)) return "png";
  if (
    head.length >= 12 &&
    head.toString("latin1", 0, 4) === "RIFF" &&
    head.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

async function readHead(file: string): Promise<Buffer> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, 12, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

class UnknownFolder extends Error {}

const describe = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : "unknown";

interface TrackPatch {
  title?: string;
  artist?: string;
  album?: string;
  folderId?: string | null;
  position?: number;
}

const PATCH_KEYS = ["title", "artist", "album", "folderId", "position"] as const;

function parsePatch(body: Record<string, unknown> | null): TrackPatch | null {
  if (!body || Object.keys(body).length === 0 || !onlyKeys(body, PATCH_KEYS)) return null;
  const patch: TrackPatch = {};
  if ("title" in body) {
    const title = requiredText(body["title"]);
    if (title === null) return null;
    patch.title = title;
  }
  for (const key of ["artist", "album"] as const) {
    if (key in body) {
      const text = optionalText(body[key]);
      if (text === null) return null;
      patch[key] = text;
    }
  }
  if ("folderId" in body) {
    const folderId = body["folderId"];
    if (!isNullableId(folderId)) return null;
    patch.folderId = folderId;
  }
  if ("position" in body) {
    const position = body["position"];
    if (!isPosition(position)) return null;
    patch.position = position;
  }
  return patch;
}

/** Serialises the file work on one track (tag rewrite, cover, delete). */
function createTrackLocks() {
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

export function adminTrackRoutes(
  deps: {
    db: DatabaseSync;
    storage: MediaStorage;
    now: () => Date;
    log?: (event: string, data?: Record<string, unknown>) => void;
  },
  session: MiddlewareHandler<AuthEnv>,
) {
  const { db, storage } = deps;
  const withLock = createTrackLocks();
  const routes = new Hono<AuthEnv>();
  routes.use("*", session, requireAdmin);

  const readyTrack = (id: string): TrackRecord | null => {
    const track = getTrack(db, id);
    return track && track.status === "ready" ? track : null;
  };

  /**
   * Rewrites the tags on a scratch copy and returns it with its sha256 and size, or null when
   * no tag could be written. The original is never touched here: the caller moves the copy
   * into place after the database commit, and removes it otherwise.
   */
  async function tagCopy(track: TrackRecord, patch: TrackPatch) {
    if (track.format === "wav") return null;
    const tags = {
      title: patch.title ?? track.title,
      artist: patch.artist ?? track.artist,
      album: patch.album ?? track.album,
    };
    const copy = storage.scratchPath(track.id);
    try {
      await copyFile(storage.originalPath(track.id, track.format), copy);
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

  routes.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const patch = parsePatch(await readJsonObject(c));
    if (!patch) {
      return jsonError(
        c,
        400,
        "bad_request",
        "Expected { title?, artist?, album?, folderId?, position? } with valid values",
      );
    }
    if (patch.folderId !== undefined && patch.folderId !== null && !getFolder(db, patch.folderId)) {
      return jsonError(c, 400, "bad_request", "Unknown folderId");
    }
    return withLock(id, async () => {
      const track = readyTrack(id);
      if (!track) return jsonError(c, 404, "not_found", "Track not found");
      const touchesTags =
        patch.title !== undefined || patch.artist !== undefined || patch.album !== undefined;
      let tagged = touchesTags ? await tagCopy(track, patch) : null;
      if (tagged) {
        const owner = findTrackBySha(db, tagged.sha256);
        if (owner && owner.id !== id) {
          // Another track already has these exact bytes: keep this file as it is.
          deps.log?.("tags.sha_collision", { trackId: id, otherId: owner.id });
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
            id,
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
            result = moveTrack(db, id, folderId, patch.position, now);
          }
          recordAdminEvent(
            db,
            {
              userId: c.get("user").id,
              action: "track_update",
              trackId: id,
              detail: { ...patch, tagsWritten },
            },
            now,
          );
          return result;
        });
      } catch (error) {
        if (tagged) await rm(tagged.copy, { force: true });
        if (error instanceof UnknownFolder) {
          return jsonError(c, 400, "bad_request", "Unknown folderId");
        }
        return catalogErrorResponse(c, error);
      }
      if (tagged) {
        try {
          await rename(tagged.copy, storage.originalPath(id, track.format));
        } catch (error) {
          // Same-directory rename: very unlikely, but the row now describes the tagged copy.
          deps.log?.("tags.replace_failed", { trackId: id, error: describe(error) });
          await rm(tagged.copy, { force: true });
        }
      }
      return c.json({ track: toTrackDto(updated), tagsWritten });
    });
  });

  routes.delete("/:id", async (c) => {
    const id = c.req.param("id");
    return withLock(id, async () => {
      const track = getTrack(db, id);
      if (!track) return jsonError(c, 404, "not_found", "Track not found");
      const now = deps.now();
      inTransaction(db, () => {
        deleteTrack(db, id);
        recordAdminEvent(
          db,
          {
            userId: c.get("user").id,
            action: "track_delete",
            trackId: id,
            detail: { title: track.title, sha256: track.sha256 },
          },
          now,
        );
      });
      // The row is gone first: the media route answers 404 even if the removal fails midway.
      try {
        await storage.removeTrack(id);
      } catch (error) {
        // The delete itself succeeded; only an orphan directory is left behind.
        deps.log?.("track.remove_failed", { trackId: id, error: describe(error) });
      }
      return c.body(null, 204);
    });
  });

  routes.post("/:id/cover", async (c) => {
    const id = c.req.param("id");
    if (!readyTrack(id)) return jsonError(c, 404, "not_found", "Track not found");
    return withLock(id, async () => {
      const upload = storage.scratchPath(id);
      try {
        const { outcome } = await receive(c.req.raw, upload, MAX_COVER_BYTES);
        if (outcome === "too_large") {
          return jsonError(c, 413, "too_large", "Image exceeds 5 MiB");
        }
        if (outcome !== "stored") {
          const message = outcome === "no_file" ? "Missing file field" : "Invalid multipart body";
          return jsonError(c, 400, "bad_request", message);
        }
        const ext = sniffImage(await readHead(upload));
        if (!ext) return jsonError(c, 400, "bad_request", "Expected a JPEG, PNG or WebP image");
        // The track may have been deleted while the body was streaming.
        if (!readyTrack(id)) return jsonError(c, 404, "not_found", "Track not found");
        const previous = readyTrack(id)?.coverExt ?? null;
        // A cover with the same extension is overwritten here; another one survives until
        // the commit, so a failed database step leaves the previous cover in use.
        await storage.replaceCover(id, upload, ext);
        const now = deps.now();
        try {
          inTransaction(db, () => {
            updateTrack(db, id, { coverExt: ext }, now);
            recordAdminEvent(
              db,
              { userId: c.get("user").id, action: "cover_replace", trackId: id, detail: { ext } },
              now,
            );
          });
        } catch (error) {
          if (previous !== ext) await rm(storage.coverPath(id, ext), { force: true });
          throw error;
        }
        await storage.removeOtherCovers(id, ext);
        return c.json({ hasCover: true });
      } finally {
        await rm(upload, { force: true });
      }
    });
  });

  return routes;
}
