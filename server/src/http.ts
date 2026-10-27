import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppConfig } from "./config.ts";

export const SESSION_COOKIE = "player_session";

export function jsonError(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function writeSessionCookie(
  c: Context,
  config: AppConfig,
  sessionId: string,
  expiresAt: Date,
  now: Date,
): void {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: config.appUrl.protocol === "https:",
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
  });
}

export function clearSessionCookie(c: Context, config: AppConfig): void {
  deleteCookie(c, SESSION_COOKIE, {
    path: "/",
    secure: config.appUrl.protocol === "https:",
  });
}

/** Parses a JSON object body; null for invalid JSON, arrays and primitives. */
export async function readJsonObject(c: Context): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return null;
  }
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}
