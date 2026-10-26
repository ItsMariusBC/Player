import { serveStatic } from "@hono/node-server/serve-static";
import type { Env, Hono, MiddlewareHandler } from "hono";

const IMMUTABLE = "public, max-age=31536000, immutable";

/** Adds Cache-Control to the response only when the file was found. */
function withCacheControl(handler: MiddlewareHandler, value: string): MiddlewareHandler {
  return async (c, next) => {
    let found = true;
    const res = await handler(c, async () => {
      found = false;
      return next();
    });
    if (found && res instanceof Response) res.headers.set("Cache-Control", value);
    return res;
  };
}

/** Serves the built frontend. Must be mounted after every API route. */
export function mountStatic<E extends Env>(app: Hono<E>, dir: string): void {
  // Compiled server code lives next to the frontend in dist; never expose it.
  app.all("/server/*", (c) => c.notFound());

  app.use("*", async (c, next) => {
    const last = c.req.path.split("/").pop() ?? "";
    if (last.startsWith(".")) return c.notFound();
    await next();
  });

  const assets = withCacheControl(serveStatic({ root: dir }), IMMUTABLE);
  app.use("/assets/*", assets);
  // A missing asset is a 404, never the SPA fallback.
  app.all("/assets/*", (c) => c.notFound());

  const asIs = serveStatic({ root: dir });
  const fallback = withCacheControl(serveStatic({ root: dir, path: "index.html" }), "no-cache");

  // Files with an extension (favicon, legacy media) are served as-is; any other
  // path is a client-side route and gets index.html.
  app.get("*", (c, next) => {
    const last = c.req.path.split("/").pop() ?? "";
    return last.includes(".") ? asIs(c, next) : fallback(c, next);
  });
}
