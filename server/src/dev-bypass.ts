// Temporary testing aid: opens a session as a fixed admin or user without the OIDC provider.
// Only mounted when config.devBypass is true, which loadConfig refuses in production.
// Delete this file, its mount in app.ts and its middleware check to remove the feature.
import type { Hono } from "hono";
import type { AuthDeps, AuthEnv } from "./auth/middleware.ts";
import { createSession } from "./auth/sessions.ts";
import { upsertUser } from "./auth/users.ts";
import { jsonError, writeSessionCookie } from "./http.ts";

export const DEV_BYPASS_ISSUER = "dev-bypass";

const IDENTITIES = {
  admin: { subject: "dev-admin", displayName: "Dev Admin" },
  user: { subject: "dev-user", displayName: "Dev User" },
} as const;

type DevRole = keyof typeof IDENTITIES;

function isDevRole(value: unknown): value is DevRole {
  return value === "admin" || value === "user";
}

export function mountDevBypass(app: Hono<AuthEnv>, deps: AuthDeps): void {
  const { config, db, now, log } = deps;

  app.use("/api/dev/*", async (c, next) => {
    await next();
    c.header("X-Dev-Bypass", "1");
  });

  app.get("/api/dev/status", (c) => c.json({ bypass: true }));

  app.post("/api/dev/login-as", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const role =
      typeof body === "object" && body !== null ? (body as { role?: unknown }).role : null;
    if (!isDevRole(role)) {
      return jsonError(c, 400, "bad_request", 'role must be "admin" or "user"');
    }
    const at = now();
    const identity = IDENTITIES[role];
    const user = upsertUser(
      db,
      {
        issuer: DEV_BYPASS_ISSUER,
        subject: identity.subject,
        displayName: identity.displayName,
        groups: [role === "admin" ? config.oidc.groupAdmin : config.oidc.groupUsers],
      },
      at,
    );
    const session = createSession(
      db,
      config.session.secret,
      { userId: user.id, ttlMs: config.session.ttlMs },
      at,
    );
    writeSessionCookie(c, config, session.id, session.expiresAt, at);
    log?.("dev.bypass_login", { role });
    return c.json({ role });
  });
}
