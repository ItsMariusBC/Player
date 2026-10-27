import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "../src/app.ts";
import { ConfigError, loadConfig } from "../src/config.ts";
import { createTestApp } from "./helpers.ts";

const CSRF = { "X-Requested-With": "player" };
const MINUTE = 60_000;

type TestApp = ReturnType<typeof createTestApp>;

function enabled(): TestApp {
  return createTestApp({ env: { DEV_BYPASS_LOGIN: "true" } });
}

function loginAs(t: TestApp, role: unknown, headers: Record<string, string> = CSRF) {
  return t.app.request("/api/dev/login-as", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

function cookieOf(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

describe("dev bypass", () => {
  it("answers status 200 when enabled", async () => {
    const t = enabled();
    const res = await t.app.request("/api/dev/status", { headers: CSRF });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { bypass: true });
    assert.equal(res.headers.get("X-Dev-Bypass"), "1");
  });

  it("does not mount the routes when disabled", async () => {
    const t = createTestApp();
    const status = await t.app.request("/api/dev/status", { headers: CSRF });
    assert.equal(status.status, 404);
    const login = await loginAs(t, "admin");
    assert.equal(login.status, 404);
  });

  it("opens an admin session with login-as admin", async () => {
    const t = enabled();
    const res = await loginAs(t, "admin");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { role: "admin" });
    assert.equal(res.headers.get("X-Dev-Bypass"), "1");
    const session = await t.app.request("/api/session", {
      headers: { ...CSRF, Cookie: cookieOf(res) },
    });
    assert.equal(session.status, 200);
    const body = (await session.json()) as { role: string; user: { displayName: string } };
    assert.equal(body.role, "admin");
    assert.equal(body.user.displayName, "Dev Admin");
  });

  it("opens a user session with login-as user", async () => {
    const t = enabled();
    const res = await loginAs(t, "user");
    const session = await t.app.request("/api/session", {
      headers: { ...CSRF, Cookie: cookieOf(res) },
    });
    const body = (await session.json()) as { role: string };
    assert.equal(body.role, "user");
  });

  it("rejects an invalid role with 400", async () => {
    const t = enabled();
    const res = await loginAs(t, "root");
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "bad_request");
  });

  it("rejects a POST without the CSRF header", async () => {
    const t = enabled();
    const res = await loginAs(t, "admin", {});
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "csrf");
  });

  it("does not recheck a bypass session against the IdP", async () => {
    const t = enabled();
    const res = await loginAs(t, "admin");
    t.advance(16 * MINUTE);
    const session = await t.app.request("/api/session", {
      headers: { ...CSRF, Cookie: cookieOf(res) },
    });
    assert.equal(session.status, 200);
  });

  it("expires a leftover bypass session once the bypass is disabled", async () => {
    const t = enabled();
    const res = await loginAs(t, "admin");
    const app = createApp({
      config: { ...t.config, devBypass: false },
      db: t.db,
      oidc: t.oidc,
      now: t.now,
    });
    t.advance(16 * MINUTE);
    const session = await app.request("/api/session", {
      headers: { ...CSRF, Cookie: cookieOf(res) },
    });
    assert.equal(session.status, 401);
    const body = (await session.json()) as { error: { code: string } };
    assert.equal(body.error.code, "session_expired");
  });

  it("refuses DEV_BYPASS_LOGIN=true in production", () => {
    const env = {
      APP_URL: "https://player.example",
      NODE_ENV: "production",
      OIDC_ISSUER: "https://idp.example",
      OIDC_CLIENT_ID: "id",
      OIDC_CLIENT_SECRET: "secret",
      SESSION_SECRET: "ab".repeat(32),
    };
    assert.throws(
      () => loadConfig({ ...env, DEV_BYPASS_LOGIN: "true" }),
      (error) => error instanceof ConfigError && /DEV_BYPASS_LOGIN/.test(error.message),
    );
    assert.equal(loadConfig(env).devBypass, false);
  });
});
