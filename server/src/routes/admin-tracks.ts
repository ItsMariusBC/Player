import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { open, rm } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { recordAdminEvent } from "../admin/events.ts";
import {
  applyCoverFile,
  applyTrackPatch,
  createTrackLocks,
  readyTrack,
  TrackNotFound,
  UnknownFolder,
  type TrackPatch,
  type WithTrackLock,
} from "../admin/track-edit.ts";
import { requireAdmin, type AuthEnv } from "../auth/middleware.ts";
import { getFolder } from "../catalog/folders.ts";
import { deleteTrack, getTrack, toTrackDto } from "../catalog/tracks.ts";
import { inTransaction } from "../catalog/tx.ts";
import { jsonError, readJsonObject } from "../http.ts";
import { MAX_COVER_BYTES, sniffImage } from "../media/image.ts";
import type { MediaStorage } from "../media/storage.ts";
import {
  catalogErrorResponse,
  isNullableId,
  isPosition,
  onlyKeys,
  optionalText,
  requiredText,
} from "./catalog-errors.ts";
import { receive } from "./multipart.ts";

export { MAX_COVER_BYTES, sniffImage };

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

const describe = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : "unknown";

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

export function adminTrackRoutes(
  deps: {
    db: DatabaseSync;
    storage: MediaStorage;
    now: () => Date;
    log?: (event: string, data?: Record<string, unknown>) => void;
    /** The app-wide track lock; a private one when omitted. */
    trackLocks?: WithTrackLock;
  },
  session: MiddlewareHandler<AuthEnv>,
) {
  const { db, storage } = deps;
  const withLock = deps.trackLocks ?? createTrackLocks();
  const routes = new Hono<AuthEnv>();
  routes.use("*", session, requireAdmin);

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
      try {
        const { track, tagsWritten } = await applyTrackPatch(deps, id, patch, {
          userId: c.get("user").id,
          action: "track_update",
          detail: { ...patch },
        });
        return c.json({ track: toTrackDto(track), tagsWritten });
      } catch (error) {
        if (error instanceof TrackNotFound)
          return jsonError(c, 404, "not_found", "Track not found");
        if (error instanceof UnknownFolder) {
          return jsonError(c, 400, "bad_request", "Unknown folderId");
        }
        return catalogErrorResponse(c, error);
      }
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
    if (!readyTrack(db, id)) return jsonError(c, 404, "not_found", "Track not found");
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
        try {
          await applyCoverFile(deps, id, upload, ext, {
            userId: c.get("user").id,
            action: "cover_replace",
            detail: { ext },
          });
        } catch (error) {
          // The track may have been deleted while the body was streaming.
          if (error instanceof TrackNotFound) {
            return jsonError(c, 404, "not_found", "Track not found");
          }
          throw error;
        }
        return c.json({ hasCover: true });
      } finally {
        await rm(upload, { force: true });
      }
    });
  });

  return routes;
}
