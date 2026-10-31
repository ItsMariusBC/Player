import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { Health } from "../health.ts";
import { requireAdmin, type AuthEnv } from "../auth/middleware.ts";

export function adminHealthRoutes(deps: { health: Health }, session: MiddlewareHandler<AuthEnv>) {
  const routes = new Hono<AuthEnv>();
  routes.use("*", session, requireAdmin);
  routes.get("/", async (c) => c.json(await deps.health.evaluate()));
  return routes;
}
