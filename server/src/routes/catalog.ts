import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { DatabaseSync } from "node:sqlite";
import type { AuthEnv } from "../auth/middleware.ts";
import { listFolders } from "../catalog/folders.ts";
import { listTracks } from "../catalog/tracks.ts";
import { buildFolderTree } from "../catalog/tree.ts";
import type { TrackDto } from "../catalog/types.ts";

export function catalogRoutes(deps: { db: DatabaseSync }, session: MiddlewareHandler<AuthEnv>) {
  const routes = new Hono<AuthEnv>();

  // Both roles may read the catalogue.
  routes.get("/", session, (c) => {
    const tracks: TrackDto[] = listTracks(deps.db).map((t) => ({
      id: t.id,
      folderId: t.folderId,
      title: t.title,
      artist: t.artist,
      album: t.album,
      durationMs: t.durationMs,
      format: t.format,
      hasCover: t.coverExt !== null,
      position: t.position,
    }));
    c.header("Cache-Control", "private, no-store");
    return c.json({ folders: buildFolderTree(listFolders(deps.db)), tracks });
  });

  return routes;
}
