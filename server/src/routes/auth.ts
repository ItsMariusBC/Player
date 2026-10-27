import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthDeps } from "../auth/middleware.ts";
import { resolveRole } from "../auth/roles.ts";
import { createSession, deleteSession, findSession } from "../auth/sessions.ts";
import { upsertUser } from "../auth/users.ts";
import { open, seal } from "../crypto.ts";
import { clearSessionCookie, jsonError, readSessionCookie, writeSessionCookie } from "../http.ts";

const OIDC_COOKIE = "player_oidc";
const OIDC_TTL_SECONDS = 600;

interface OidcCookie {
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: string;
}

function parseOidcCookie(raw: string | undefined, key: Buffer, now: Date): OidcCookie | null {
  if (!raw) return null;
  const plain = open(raw, key);
  if (plain === null) return null;
  try {
    const data: unknown = JSON.parse(plain);
    if (typeof data !== "object" || data === null) return null;
    const { state, nonce, codeVerifier, createdAt } = data as Record<string, unknown>;
    if (
      typeof state !== "string" ||
      typeof nonce !== "string" ||
      typeof codeVerifier !== "string" ||
      typeof createdAt !== "string"
    ) {
      return null;
    }
    const age = now.getTime() - new Date(createdAt).getTime();
    if (!Number.isFinite(age) || age > OIDC_TTL_SECONDS * 1000) return null;
    return { state, nonce, codeVerifier, createdAt };
  } catch {
    return null;
  }
}

export function authRoutes(deps: AuthDeps) {
  const { config, db, oidc, now, log } = deps;
  const secure = config.appUrl.protocol === "https:";
  const redirectUri = () => new URL("/api/auth/callback", config.appUrl);
  const app = new Hono();

  app.get("/login", async (c) => {
    let login;
    try {
      login = await oidc.startLogin(redirectUri());
    } catch (err) {
      log?.("auth.login_unavailable", { error: err instanceof Error ? err.name : "unknown" });
      return jsonError(c, 502, "oidc_unavailable", "Identity provider unavailable");
    }
    const { url, state, nonce, codeVerifier } = login;
    const payload: OidcCookie = { state, nonce, codeVerifier, createdAt: now().toISOString() };
    setCookie(c, OIDC_COOKIE, seal(JSON.stringify(payload), config.session.secret), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure,
      maxAge: OIDC_TTL_SECONDS,
    });
    return c.redirect(url.toString(), 302);
  });

  app.get("/callback", async (c) => {
    // The login attempt is single use: drop the sealed state on every exit.
    deleteCookie(c, OIDC_COOKIE, { path: "/", secure });
    const invalid = () => jsonError(c, 400, "oidc_state", "Login state is missing or invalid");
    const pending = parseOidcCookie(getCookie(c, OIDC_COOKIE), config.session.secret, now());
    if (!pending) return invalid();

    // Rebuild the callback URL from the configured app URL: the request's own
    // origin may differ behind a reverse proxy. Only the query string is kept.
    const callbackUrl = redirectUri();
    callbackUrl.search = new URL(c.req.url).search;

    let tokens;
    try {
      tokens = await oidc.completeLogin(callbackUrl, {
        state: pending.state,
        nonce: pending.nonce,
        codeVerifier: pending.codeVerifier,
        redirectUri: redirectUri(),
      });
    } catch (err) {
      log?.("auth.callback_failed", { error: err instanceof Error ? err.name : "unknown" });
      return invalid();
    }

    const claims = tokens.claims;
    if (typeof claims.sub !== "string") return invalid();

    const { groups, reason } = resolveRole(claims, config.oidc);
    const user = upsertUser(
      db,
      {
        issuer: config.oidc.issuer,
        subject: claims.sub,
        displayName:
          typeof claims.name === "string"
            ? claims.name
            : typeof claims.preferred_username === "string"
              ? claims.preferred_username
              : undefined,
        email: typeof claims.email === "string" ? claims.email : undefined,
        groups,
      },
      now(),
    );
    if (reason === "missing_claim") {
      log?.("auth.groups_claim_missing", { claim: config.oidc.groupsClaim, userId: user.id });
    }
    const session = createSession(
      db,
      config.session.secret,
      {
        userId: user.id,
        refreshToken: tokens.refreshToken,
        idToken: tokens.idToken,
        ttlMs: config.session.ttlMs,
      },
      now(),
    );
    writeSessionCookie(c, config, session.id, session.expiresAt, now());
    return c.redirect("/", 302);
  });

  app.post("/logout", async (c) => {
    let redirect = "/api/auth/login";
    const id = readSessionCookie(c);
    const session = id ? findSession(db, config.session.secret, id, now()) : null;
    if (id && session) {
      if (session.refreshToken) {
        try {
          await oidc.revoke(session.refreshToken);
        } catch (err) {
          log?.("auth.revoke_failed", { error: err instanceof Error ? err.name : "unknown" });
        }
      }
      deleteSession(db, id);
      clearSessionCookie(c, config);
      redirect =
        oidc.endSessionUrl(session.idToken || undefined, config.appUrl)?.toString() ?? redirect;
    }
    return c.json({ redirect });
  });

  return app;
}
