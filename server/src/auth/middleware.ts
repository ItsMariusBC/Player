import { createMiddleware } from "hono/factory";
import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.ts";
import { clearSessionCookie, jsonError, readSessionCookie } from "../http.ts";
import type { OidcAdapter } from "./oidc.ts";
import { resolveRole, type Role } from "./roles.ts";
import { deleteSession, findSession, markGroupsChecked, type SessionRecord } from "./sessions.ts";
import { findUserById, upsertUser, type UserRecord } from "./users.ts";

export type AuthEnv = {
  Variables: { session: SessionRecord; user: UserRecord; role: Role };
};

export interface AuthDeps {
  config: AppConfig;
  db: DatabaseSync;
  oidc: OidcAdapter;
  now: () => Date;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

function profileFrom(claims: Record<string, unknown>) {
  const name = typeof claims.name === "string" ? claims.name : claims.preferred_username;
  return {
    subject: String(claims.sub),
    displayName: typeof name === "string" ? name : undefined,
    email: typeof claims.email === "string" ? claims.email : undefined,
  };
}

// Loads the session, rechecks groups against the IdP when due and sets session, user, role.
export function requireSession(deps: AuthDeps) {
  const { config, db, oidc, log } = deps;
  return createMiddleware<AuthEnv>(async (c, next) => {
    const id = readSessionCookie(c);
    if (!id) return jsonError(c, 401, "session_required", "Authentication required");
    const now = deps.now();
    const session = findSession(db, config.session.secret, id, now);
    if (!session) {
      clearSessionCookie(c, config);
      return jsonError(c, 401, "session_required", "Authentication required");
    }

    let current = session;
    if (now.getTime() - session.groupsCheckedAt.getTime() >= config.session.groupsRecheckMs) {
      try {
        if (session.refreshToken === null) throw new Error("no refresh token");
        const tokens = await oidc.refresh(session.refreshToken);
        const resolution = resolveRole(tokens.claims, config.oidc);
        const profile = profileFrom(tokens.claims);
        upsertUser(db, { issuer: config.oidc.issuer, ...profile, groups: resolution.groups }, now);
        markGroupsChecked(
          db,
          session.id,
          {
            refreshToken: tokens.refreshToken ?? undefined,
            idToken: tokens.idToken || undefined,
          },
          config.session.secret,
          now,
        );
        current = { ...session, groupsCheckedAt: now };
      } catch (error) {
        log?.("session.refresh_failed", {
          userId: session.userId,
          reason: error instanceof Error ? error.message : "unknown",
        });
        deleteSession(db, session.id);
        clearSessionCookie(c, config);
        return jsonError(c, 401, "session_expired", "Session expired, please sign in again");
      }
    }

    const user = findUserById(db, current.userId);
    if (!user) {
      deleteSession(db, current.id);
      clearSessionCookie(c, config);
      return jsonError(c, 401, "session_required", "Authentication required");
    }
    const resolution = resolveRole({ [config.oidc.groupsClaim]: user.groups }, config.oidc);
    if (resolution.role === null) {
      log?.("role.denied", { userId: user.id, reason: resolution.reason });
      return jsonError(c, 403, "no_group", "Your account is not allowed to use this application");
    }
    c.set("session", current);
    c.set("user", user);
    c.set("role", resolution.role);
    await next();
  });
}

export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  if (c.get("role") !== "admin") {
    return jsonError(c, 403, "admin_required", "Administrator role required");
  }
  await next();
});

const UNSAFE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export const requireRequestedWith = createMiddleware(async (c, next) => {
  if (UNSAFE_METHODS.has(c.req.method) && c.req.header("x-requested-with") !== "player") {
    return jsonError(c, 403, "csrf", "Missing X-Requested-With header");
  }
  await next();
});
