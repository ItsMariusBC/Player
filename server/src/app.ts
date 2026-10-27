import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { DatabaseSync } from "node:sqlite";
import { requireRequestedWith, requireSession, type AuthEnv } from "./auth/middleware.ts";
import type { OidcAdapter } from "./auth/oidc.ts";
import { mountDevBypass } from "./dev-bypass.ts";
import type { AppConfig } from "./config.ts";
import { jsonError } from "./http.ts";
import { authRoutes } from "./routes/auth.ts";
import { mountStatic } from "./static.ts";

export interface AppDeps {
  config: AppConfig;
  db: DatabaseSync;
  oidc: OidcAdapter;
  now?: () => Date;
  staticDir?: string;
  log?: (event: string, data?: Record<string, unknown>) => void;
  // Test seam: mounts extra routes behind the shared session middleware, before the API 404.
  mount?: (app: Hono<AuthEnv>, session: MiddlewareHandler<AuthEnv>) => void;
}

export function createApp(deps: AppDeps) {
  const now = deps.now ?? (() => new Date());
  const auth = { config: deps.config, db: deps.db, oidc: deps.oidc, now, log: deps.log };
  const app = new Hono<AuthEnv>();

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
  });

  app.onError((err, c) => {
    deps.log?.("server.unhandled_error", { error: err instanceof Error ? err.name : "unknown" });
    return jsonError(c, 500, "internal_error", "Unexpected server error");
  });

  app.get("/healthz", (c) => c.text("ok\n"));

  app.use("/api/*", requireRequestedWith);

  app.route("/api/auth", authRoutes(auth));

  if (deps.config.devBypass) mountDevBypass(app, auth);

  // Built once: the refresh lock lives inside this instance and must cover every protected route.
  const session = requireSession(auth);

  app.get("/api/session", session, (c) => {
    const user = c.get("user");
    return c.json({
      user: { id: user.id, displayName: user.displayName },
      role: c.get("role"),
      expiresAt: c.get("session").expiresAt.toISOString(),
    });
  });

  deps.mount?.(app, session);

  // Unknown API paths must never reach the SPA fallback.
  app.all("/api/*", (c) => jsonError(c, 404, "not_found", "Unknown API route"));

  if (deps.staticDir) mountStatic(app, deps.staticDir);

  return app;
}
