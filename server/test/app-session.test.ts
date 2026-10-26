import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTestApp } from "./helpers.ts";

const MINUTE = 60_000;

describe("GET /api/session", () => {
  it("answers 401 session_required without a cookie", async () => {
    const t = createTestApp();
    const res = await t.app.request("/api/session");
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "session_required");
  });

  it("answers 200 with role user", async () => {
    const t = createTestApp();
    const res = await t.app.request("/api/session", { headers: { cookie: t.loginAs("user") } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      user: { id: string; displayName: string };
      role: string;
      expiresAt: string;
    };
    assert.equal(body.role, "user");
    assert.equal(body.user.displayName, "User Test");
    assert.equal(
      body.expiresAt,
      new Date(t.now().getTime() + t.config.session.ttlMs).toISOString(),
    );
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  });

  it("answers 200 with role admin", async () => {
    const t = createTestApp();
    const res = await t.app.request("/api/session", { headers: { cookie: t.loginAs("admin") } });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { role: string }).role, "admin");
  });

  it("answers 403 no_group and keeps the session", async () => {
    const t = createTestApp();
    const cookie = t.loginAs("nobody");
    const res = await t.app.request("/api/session", { headers: { cookie } });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "no_group");
    const count = t.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
    assert.equal(count.n, 1);
  });

  it("rechecks groups after 16 minutes and downgrades to no_group", async () => {
    const t = createTestApp();
    const cookie = t.loginAs("user");
    t.accounts.user!.claims.groups = [];
    t.advance(16 * MINUTE);
    const res = await t.app.request("/api/session", { headers: { cookie } });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "no_group");
    const row = t.db.prepare("SELECT groups FROM users WHERE subject = 'user-sub'").get() as {
      groups: string;
    };
    assert.deepEqual(JSON.parse(row.groups), []);
  });

  it("does not call refresh before the recheck delay", async () => {
    const t = createTestApp();
    const cookie = t.loginAs("user");
    t.accounts.user!.refreshFails = true;
    t.advance(10 * MINUTE);
    const res = await t.app.request("/api/session", { headers: { cookie } });
    assert.equal(res.status, 200);
  });

  it("answers 401 session_expired, clears the cookie and deletes the session when refresh fails", async () => {
    const t = createTestApp();
    const cookie = t.loginAs("user");
    t.accounts.user!.refreshFails = true;
    t.advance(16 * MINUTE);
    const res = await t.app.request("/api/session", { headers: { cookie } });
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "session_expired");
    assert.match(res.headers.get("set-cookie") ?? "", /Max-Age=0/);
    const count = t.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
    assert.equal(count.n, 0);
  });
});

describe("app", () => {
  it("answers GET /healthz without a session", async () => {
    const t = createTestApp();
    const res = await t.app.request("/healthz");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok\n");
    assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
  });

  it("answers 403 csrf on POST /api/session without X-Requested-With", async () => {
    const t = createTestApp();
    const res = await t.app.request("/api/session", {
      method: "POST",
      headers: { cookie: t.loginAs("user") },
    });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "csrf");
  });
});
