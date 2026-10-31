import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { DatabaseSync } from "node:sqlite";
import type { ImportQueue } from "../admin/imports.ts";
import { recordAdminEvent } from "../admin/events.ts";
import { requireAdmin, type AuthEnv } from "../auth/middleware.ts";
import { jsonError } from "../http.ts";

export function adminLoudnessRoutes(
  deps: { db: DatabaseSync; imports: ImportQueue; now: () => Date },
  session: MiddlewareHandler<AuthEnv>,
) {
  const routes = new Hono<AuthEnv>();
  routes.use("*", session, requireAdmin);

  routes.get("/", async (c) => c.json(await deps.imports.loudnessStatus()));

  routes.post("/backfill", async (c) => {
    if (!(await deps.imports.loudnessStatus()).available) {
      return jsonError(c, 409, "ffmpeg_unavailable", "ffmpeg is not available on the server");
    }
    const result = deps.imports.backfillLoudness();
    // Only a pass that just started is an event; a second call during a pass queues nothing.
    if (result.queued > 0) {
      recordAdminEvent(
        deps.db,
        {
          userId: c.get("user").id,
          action: "loudness_backfill",
          detail: { queued: result.queued },
        },
        deps.now(),
      );
    }
    return c.json(result, 202);
  });

  return routes;
}
