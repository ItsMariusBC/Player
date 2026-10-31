import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { DatabaseSync } from "node:sqlite";
import type { AuthEnv } from "../auth/middleware.ts";
import { getTrack } from "../catalog/tracks.ts";
import { jsonError } from "../http.ts";
import { parseRange } from "../http-range.ts";
import type { MediaStorage } from "../media/storage.ts";

const AUDIO_TYPES = { flac: "audio/flac", mp3: "audio/mpeg", wav: "audio/wav" } as const;
const COVER_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

async function sizeOf(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

export function mediaRoutes(
  deps: { db: DatabaseSync; storage: MediaStorage },
  session: MiddlewareHandler<AuthEnv>,
) {
  const routes = new Hono<AuthEnv>();

  routes.on(["GET", "HEAD"], "/:trackId", session, async (c) => {
    const track = getTrack(deps.db, c.req.param("trackId"));
    if (!track || track.status !== "ready") {
      return jsonError(c, 404, "not_found", "Track not found");
    }
    const file = deps.storage.originalPath(track.id, track.format);
    const size = await sizeOf(file);
    if (size === null) return jsonError(c, 404, "not_found", "Track not found");

    const headers: Record<string, string> = {
      "Content-Type": AUDIO_TYPES[track.format],
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
    };
    const range = parseRange(c.req.header("range"), size);
    if (range === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    headers["Content-Length"] = String(end - start + 1);
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    const status = range ? 206 : 200;

    if (c.req.method === "HEAD") return new Response(null, { status, headers });
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, { status, headers });
  });

  routes.on(["GET", "HEAD"], "/:trackId/cover", session, async (c) => {
    const track = getTrack(deps.db, c.req.param("trackId"));
    const ext = track?.coverExt;
    const type = ext ? COVER_TYPES[ext] : undefined;
    if (!track || track.status !== "ready" || !ext || !type) {
      return jsonError(c, 404, "not_found", "Cover not found");
    }
    const file = deps.storage.coverPath(track.id, ext as "jpg" | "png" | "webp");
    const size = await sizeOf(file);
    if (size === null) return jsonError(c, 404, "not_found", "Cover not found");
    const headers = {
      "Content-Type": type,
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=300",
    };
    if (c.req.method === "HEAD") return new Response(null, { status: 200, headers });
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
    return new Response(body, { status: 200, headers });
  });

  return routes;
}
