import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { DatabaseSync } from "node:sqlite";
import type { ImportQueue } from "../admin/imports.ts";
import { recordAdminEvent } from "../admin/events.ts";
import { requireAdmin, type AuthEnv } from "../auth/middleware.ts";

export function adminLoudnessRoutes(
  deps: { db: DatabaseSync; imports: ImportQueue; now: () => Date },
  session: MiddlewareHandler<AuthEnv>,
) {
  const routes = new Hono<AuthEnv>();
  routes.use("*", session, requireAdmin);

  routes.get("/", async (c) => c.json(await deps.imports.loudnessStatus()));

  routes.post("/backfill", (c) => {
    const queued = deps.imports.backfillLoudness();
    recordAdminEvent(
      deps.db,
      { userId: c.get("user").id, action: "loudness_backfill", detail: { queued } },
      deps.now(),
    );
    return c.json({ queued }, 202);
  });

  return routes;
}
