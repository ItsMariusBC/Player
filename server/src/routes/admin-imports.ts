import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { isIP } from "node:net";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ImportQueue } from "../admin/imports.ts";
import { requireAdmin, type AuthEnv } from "../auth/middleware.ts";
import type { AppConfig } from "../config.ts";
import { jsonError } from "../http.ts";
import type { MediaStorage } from "../media/storage.ts";
import { receive } from "./multipart.ts";

interface ImportRow {
  id: string;
  filename: string;
  state: string;
  error: string | null;
  track_id: string | null;
  created_at: string;
  updated_at: string;
}

const MAX_URL_LENGTH = 2048;

/** Last path segment, decoded, with anything outside [\w.-] replaced; "download" when empty. */
function filenameFromUrl(url: URL): string {
  const segment = url.pathname.split("/").filter(Boolean).pop() ?? "";
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Keep the raw segment.
  }
  const name = decoded.replace(/[^\w.-]/g, "_").slice(0, 120);
  return name === "" || /^\.+$/.test(name) ? "download" : name;
}

const toDto = (row: ImportRow) => ({
  id: row.id,
  filename: row.filename,
  state: row.state,
  error: row.error ? (JSON.parse(row.error) as unknown) : null,
  trackId: row.track_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function adminImportRoutes(
  deps: {
    db: DatabaseSync;
    storage: MediaStorage;
    imports: ImportQueue;
    config: AppConfig;
    now: () => Date;
  },
  session: MiddlewareHandler<AuthEnv>,
) {
  const routes = new Hono<AuthEnv>();
  routes.use("*", session, requireAdmin);

  const folderExists = (id: string) =>
    deps.db.prepare("SELECT 1 FROM folders WHERE id = ?").get(id) !== undefined;

  routes.post("/", async (c) => {
    const importId = crypto.randomUUID();
    const dir = deps.storage.incomingDir(importId);
    const { outcome, filename, folderId } = await receive(
      c.req.raw,
      path.join(dir, "upload.bin"),
      deps.config.maxUploadBytes,
    );
    if (outcome !== "stored") {
      await deps.storage.removeIncoming(importId);
      if (outcome === "too_large") {
        return jsonError(c, 413, "too_large", "File exceeds the maximum upload size");
      }
      const message = outcome === "no_file" ? "Missing file field" : "Invalid multipart body";
      return jsonError(c, 400, "bad_request", message);
    }
    if (folderId !== null && !folderExists(folderId)) {
      await deps.storage.removeIncoming(importId);
      return jsonError(c, 400, "bad_request", "Unknown folder");
    }
    const stamp = deps.now().toISOString();
    try {
      deps.db
        .prepare(
          "INSERT INTO imports (id, user_id, filename, state, error, track_id, folder_id, created_at, updated_at) VALUES (?, ?, ?, 'processing', NULL, NULL, ?, ?, ?)",
        )
        .run(importId, c.get("user").id, filename, folderId, stamp, stamp);
    } catch (error) {
      await deps.storage.removeIncoming(importId);
      throw error;
    }
    deps.imports.enqueue(importId);
    return c.json({ importId }, 202);
  });

  routes.post("/url", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      url?: unknown;
      folderId?: unknown;
    } | null;
    if (!body || typeof body !== "object") return jsonError(c, 400, "bad_request", "Invalid body");
    const { url: raw, folderId } = body;
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) {
      return jsonError(c, 400, "bad_request", "Invalid url");
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return jsonError(c, 400, "bad_request", "Invalid url");
    }
    if (url.protocol !== "https:" || isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0) {
      return jsonError(c, 400, "bad_request", "Only https URLs with a host name are accepted");
    }
    if (folderId !== undefined && folderId !== null) {
      if (typeof folderId !== "string" || !folderExists(folderId)) {
        return jsonError(c, 400, "bad_request", "Unknown folder");
      }
    }
    const importId = crypto.randomUUID();
    const stamp = deps.now().toISOString();
    deps.db
      .prepare(
        "INSERT INTO imports (id, user_id, filename, state, error, track_id, folder_id, source_url, created_at, updated_at) VALUES (?, ?, ?, 'processing', NULL, NULL, ?, ?, ?, ?)",
      )
      .run(importId, c.get("user").id, filenameFromUrl(url), folderId ?? null, raw, stamp, stamp);
    deps.imports.enqueueUrl(importId, raw);
    return c.json({ importId }, 202);
  });

  routes.get("/", (c) => {
    const raw = Number(c.req.query("limit") ?? 50);
    const limit = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 200) : 50;
    const rows = deps.db
      .prepare("SELECT * FROM imports ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(limit) as unknown as ImportRow[];
    return c.json(rows.map(toDto));
  });

  routes.get("/:id", (c) => {
    const row = deps.db
      .prepare("SELECT * FROM imports WHERE id = ?")
      .get(c.req.param("id")) as unknown as ImportRow | undefined;
    if (!row) return jsonError(c, 404, "not_found", "Import not found");
    return c.json(toDto(row));
  });

  return routes;
}

/** GET /api/admin/limits: lets the panel refuse oversized files before sending them. */
export function adminLimitsRoutes(
  deps: { config: AppConfig },
  session: MiddlewareHandler<AuthEnv>,
) {
  const routes = new Hono<AuthEnv>();
  routes.use("*", session, requireAdmin);
  routes.get("/", (c) => c.json({ maxUploadBytes: deps.config.maxUploadBytes }));
  return routes;
}
