import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { DatabaseSync } from "node:sqlite";
import { recordAdminEvent } from "../admin/events.ts";
import type { Maintenance } from "../admin/maintenance.ts";
import { requireAdmin, type AuthEnv } from "../auth/middleware.ts";

export function adminMaintenanceRoutes(
  deps: { db: DatabaseSync; maintenance: Maintenance; now: () => Date },
  session: MiddlewareHandler<AuthEnv>,
) {
  const routes = new Hono<AuthEnv>();
  routes.use("*", session, requireAdmin);

  routes.get("/", (c) => c.json(deps.maintenance.status()));

  routes.post("/run", async (c) => {
    const result = await deps.maintenance.run();
    recordAdminEvent(
      deps.db,
      { userId: c.get("user").id, action: "maintenance_run", detail: { ...result } },
      deps.now(),
    );
    return c.json(result);
  });

  return routes;
}
