import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
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

  routes.post("/", async (c) => {
    const importId = crypto.randomUUID();
    const dir = deps.storage.incomingDir(importId);
    const { outcome, filename } = await receive(
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
    const stamp = deps.now().toISOString();
    try {
      deps.db
        .prepare(
          "INSERT INTO imports (id, user_id, filename, state, error, track_id, created_at, updated_at) VALUES (?, ?, ?, 'processing', NULL, NULL, ?, ?)",
        )
        .run(importId, c.get("user").id, filename, stamp, stamp);
    } catch (error) {
      await deps.storage.removeIncoming(importId);
      throw error;
    }
    deps.imports.enqueue(importId);
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
