import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { DatabaseSync } from "node:sqlite";
import type { AuthEnv } from "../auth/middleware.ts";
import { getTrack } from "../catalog/tracks.ts";
import { jsonError } from "../http.ts";
import { etagMatches, httpDate } from "../http-cache.ts";
import { parseRange } from "../http-range.ts";
import type { MediaStorage } from "../media/storage.ts";

const AUDIO_TYPES = { flac: "audio/flac", mp3: "audio/mpeg", wav: "audio/wav" } as const;
const COVER_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const IMMUTABLE = "private, max-age=31536000, immutable";

async function statFile(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? { size: info.size, mtimeMs: info.mtimeMs } : null;
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
    let file = deps.storage.originalPath(track.id, track.format);
    let type: string = AUDIO_TYPES[track.format];
    let variant: string = track.format;
    let info: { size: number; mtimeMs: number } | null = null;
    if (c.req.query("q") === "light" && track.aacSizeBytes !== null) {
      info = await statFile(deps.storage.variantPath(track.id));
      if (info) {
        file = deps.storage.variantPath(track.id);
        type = "audio/mp4";
        variant = "aac";
      }
    }
    info ??= await statFile(file);
    if (info === null) return jsonError(c, 404, "not_found", "Track not found");
    const { size } = info;

    const etag = `"${track.sha256}:${variant}"`;
    const headers: Record<string, string> = {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Cache-Control": IMMUTABLE,
      ETag: etag,
      "Last-Modified": httpDate(info.mtimeMs),
    };
    if (etagMatches(c.req.header("if-none-match"), etag)) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": IMMUTABLE },
      });
    }
    const ifRange = c.req.header("if-range");
    const rangeHeader =
      ifRange !== undefined && ifRange.trim() !== etag ? undefined : c.req.header("range");
    const range = parseRange(rangeHeader, size);
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
    const body = Readable.toWeb(
      createReadStream(file, { start, end, highWaterMark: 256 * 1024 }),
    ) as ReadableStream;
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
    const info = await statFile(file);
    if (info === null) return jsonError(c, 404, "not_found", "Cover not found");
    const headers = {
      "Content-Type": type,
      "Content-Length": String(info.size),
      "Cache-Control": c.req.query("v") !== undefined ? IMMUTABLE : "private, max-age=300",
    };
    if (c.req.method === "HEAD") return new Response(null, { status: 200, headers });
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
    return new Response(body, { status: 200, headers });
  });

  return routes;
}
