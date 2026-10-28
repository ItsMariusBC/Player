import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { DatabaseSync } from "node:sqlite";
import { requireRequestedWith, requireSession, type AuthEnv } from "./auth/middleware.ts";
import type { OidcAdapter } from "./auth/oidc.ts";
import type { ImportQueue } from "./admin/imports.ts";
import type { Maintenance } from "./admin/maintenance.ts";
import type { Health } from "./health.ts";
import { adminHealthRoutes } from "./routes/admin-health.ts";
import { adminMaintenanceRoutes } from "./routes/admin-maintenance.ts";
import { adminFolderRoutes } from "./routes/admin-folders.ts";
import { adminImportRoutes, adminLimitsRoutes } from "./routes/admin-imports.ts";
import { createTrackLocks } from "./admin/track-edit.ts";
import type { MetadataSearch } from "./metadata/search.ts";
import { addMetadataApplyRoute, adminMetadataRoutes } from "./routes/admin-metadata.ts";
import { adminLoudnessRoutes } from "./routes/admin-loudness.ts";
import { adminMediaRoutes } from "./routes/admin-media.ts";
import { adminRequestRoutes } from "./routes/admin-requests.ts";
import { requestRoutes } from "./routes/requests.ts";
import { adminTrackRoutes } from "./routes/admin-tracks.ts";
import { mountDevBypass } from "./dev-bypass.ts";
import type { AppConfig } from "./config.ts";
import { jsonError } from "./http.ts";
import type { MediaStorage } from "./media/storage.ts";
import { authRoutes } from "./routes/auth.ts";
import { catalogRoutes } from "./routes/catalog.ts";
import { mediaRoutes } from "./routes/media.ts";
import { mountStatic } from "./static.ts";

export interface AppDeps {
  config: AppConfig;
  db: DatabaseSync;
  oidc: OidcAdapter;
  storage: MediaStorage;
  imports: ImportQueue;
  /** Metadata lookup; its routes are not mounted when omitted. */
  metadata?: MetadataSearch;
  /** Maintenance passes; its admin routes are not mounted when omitted. */
  maintenance?: Maintenance;
  /** Health: `/healthz` answers from the lightweight `check()`; the admin route is absent when omitted. */
  health?: Health;
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
    // Routes may set their own policy (for example private covers).
    if (c.req.path.startsWith("/api/") && !c.res.headers.has("Cache-Control")) {
      c.header("Cache-Control", "no-store");
    }
  });

  app.onError((err, c) => {
    deps.log?.("server.unhandled_error", { error: err instanceof Error ? err.name : "unknown" });
    return jsonError(c, 500, "internal_error", "Unexpected server error");
  });

  app.get("/healthz", async (c) => {
    const report = deps.health ? await deps.health.check() : null;
    if (report && report.status !== "ok") {
      c.header("Cache-Control", "no-store");
      return c.text("degraded\n", 503);
    }
    return c.text("ok\n");
  });

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

  app.route("/api/catalog", catalogRoutes(deps, session));
  app.route("/api/media", mediaRoutes(deps, session));

  app.route("/api/admin/imports", adminImportRoutes({ ...deps, now }, session));
  app.route("/api/admin/loudness", adminLoudnessRoutes({ ...deps, now }, session));
  app.route("/api/admin/media", adminMediaRoutes({ ...deps, now }, session));
  if (deps.maintenance) {
    app.route(
      "/api/admin/maintenance",
      adminMaintenanceRoutes({ db: deps.db, maintenance: deps.maintenance, now }, session),
    );
  }
  if (deps.health) {
    app.route("/api/admin/health", adminHealthRoutes({ health: deps.health }, session));
  }
  app.route("/api/admin/limits", adminLimitsRoutes(deps, session));
  app.route("/api/admin/folders", adminFolderRoutes({ ...deps, now }, session));
  // One lock for every route that touches a track's files (PATCH, DELETE, cover, metadata).
  const trackLocks = createTrackLocks();
  const trackRoutes = adminTrackRoutes({ ...deps, now, trackLocks }, session);
  if (deps.metadata) {
    addMetadataApplyRoute(trackRoutes, { ...deps, metadata: deps.metadata, now, trackLocks });
    app.route("/api/admin/metadata", adminMetadataRoutes({ metadata: deps.metadata }, session));
  }
  app.route("/api/admin/tracks", trackRoutes);

  app.route("/api/requests", requestRoutes({ ...deps, now }, session));
  app.route("/api/admin/requests", adminRequestRoutes({ ...deps, now }, session));

  deps.mount?.(app, session);

  // Unknown API paths must never reach the SPA fallback.
  app.all("/api/*", (c) => jsonError(c, 404, "not_found", "Unknown API route"));

  if (deps.staticDir) mountStatic(app, deps.staticDir);

  return app;
}
