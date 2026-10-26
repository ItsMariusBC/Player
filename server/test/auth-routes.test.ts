import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seal } from "../src/crypto.ts";
import { createTestApp } from "./helpers.ts";

const CSRF = { "X-Requested-With": "player" };

function cookieValue(res: Response, name: string): string {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  assert.ok(line, `missing Set-Cookie ${name}`);
  return line.split(";")[0]!.slice(name.length + 1);
}

function count(t: ReturnType<typeof createTestApp>, table: string): number {
  const row = t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

async function startLogin(t: ReturnType<typeof createTestApp>) {
  const res = await t.app.request("/api/auth/login");
  return { res, oidcCookie: `player_oidc=${cookieValue(res, "player_oidc")}` };
}

describe("auth routes", () => {
  for (const appUrl of ["http://localhost:3000", "https://player.example"]) {
    const secure = appUrl.startsWith("https:");

    describe(`APP_URL=${appUrl}`, () => {
      it("login redirects to the IdP and sets the player_oidc cookie", async () => {
        const t = createTestApp({ appUrl });
        const { res } = await startLogin(t);
        assert.equal(res.status, 302);
        assert.ok(res.headers.get("location")?.startsWith("http://fake-idp/authorize"));
        const line = res.headers.getSetCookie().find((c) => c.startsWith("player_oidc="))!;
        assert.match(line, /HttpOnly/i);
        assert.match(line, /SameSite=Lax/i);
        assert.match(line, /Path=\//);
        assert.match(line, /Max-Age=600/);
        assert.equal(/;\s*Secure/i.test(line), secure);
      });

      it("callback creates user and session, sets the session cookie, clears player_oidc", async () => {
        const t = createTestApp({ appUrl });
        const { oidcCookie } = await startLogin(t);
        const res = await t.app.request("/api/auth/callback?code=admin&state=fake-state", {
          headers: { cookie: oidcCookie },
        });
        assert.equal(res.status, 302);
        assert.equal(res.headers.get("location"), "/");
        const line = res.headers.getSetCookie().find((c) => c.startsWith("player_session="))!;
        assert.ok(line);
        assert.match(line, /HttpOnly/i);
        assert.match(line, /SameSite=Lax/i);
        assert.match(line, /Path=\//);
        assert.equal(/;\s*Secure/i.test(line), secure);
        const cleared = res.headers.getSetCookie().find((c) => c.startsWith("player_oidc="))!;
        assert.ok(cleared);
        assert.match(cleared, /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
        assert.equal(count(t, "users"), 1);
        assert.equal(count(t, "sessions"), 1);

        const sessionRes = await t.app.request("/api/session", {
          headers: { cookie: `player_session=${cookieValue(res, "player_session")}` },
        });
        assert.equal(sessionRes.status, 200);
      });
    });
  }

  it("callback without cookie answers 400 oidc_state and creates no session", async () => {
    const t = createTestApp();
    const res = await t.app.request("/api/auth/callback?code=admin&state=fake-state");
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "oidc_state");
    assert.equal(count(t, "sessions"), 0);
  });

  it("replaying the callback without the cleared cookie answers 400", async () => {
    const t = createTestApp();
    const { oidcCookie } = await startLogin(t);
    const first = await t.app.request("/api/auth/callback?code=admin&state=fake-state", {
      headers: { cookie: oidcCookie },
    });
    assert.equal(first.status, 302);
    const replay = await t.app.request("/api/auth/callback?code=admin&state=fake-state");
    assert.equal(replay.status, 400);
    assert.equal(count(t, "sessions"), 1);
  });

  it("callback with an unreadable or expired cookie answers 400 oidc_state", async () => {
    const t = createTestApp();
    const garbage = await t.app.request("/api/auth/callback?code=admin&state=fake-state", {
      headers: { cookie: "player_oidc=garbage" },
    });
    assert.equal(garbage.status, 400);

    const { oidcCookie } = await startLogin(t);
    t.advance(10 * 60_000 + 1000);
    const old = await t.app.request("/api/auth/callback?code=admin&state=fake-state", {
      headers: { cookie: oidcCookie },
    });
    assert.equal(old.status, 400);

    const badJson = seal("not json", t.config.session.secret);
    const res = await t.app.request("/api/auth/callback?code=admin&state=fake-state", {
      headers: { cookie: `player_oidc=${badJson}` },
    });
    assert.equal(res.status, 400);
    assert.equal(count(t, "sessions"), 0);
  });

  it("callback answers 400 oidc_state when completeLogin throws", async () => {
    const t = createTestApp();
    const { oidcCookie } = await startLogin(t);
    const res = await t.app.request("/api/auth/callback?code=admin&state=wrong", {
      headers: { cookie: oidcCookie },
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "oidc_state");
    assert.equal(count(t, "sessions"), 0);
  });

  it("callback still creates a session when no role resolves", async () => {
    const t = createTestApp();
    const { oidcCookie } = await startLogin(t);
    const res = await t.app.request("/api/auth/callback?code=nobody&state=fake-state", {
      headers: { cookie: oidcCookie },
    });
    assert.equal(res.status, 302);
    assert.equal(count(t, "sessions"), 1);
  });

  it("callback rejects claims without a string sub", async () => {
    const t = createTestApp({ accounts: { odd: { claims: { sub: 42 } } } });
    const { oidcCookie } = await startLogin(t);
    const res = await t.app.request("/api/auth/callback?code=odd&state=fake-state", {
      headers: { cookie: oidcCookie },
    });
    assert.equal(res.status, 400);
    assert.equal(count(t, "sessions"), 0);
  });

  it("logout without the CSRF header answers 403 csrf", async () => {
    const t = createTestApp();
    const res = await t.app.request("/api/auth/logout", { method: "POST" });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "csrf");
  });

  it("logout with a session revokes, deletes the session and returns the end-session URL", async () => {
    const t = createTestApp();
    const cookie = t.loginAs("user");
    const res = await t.app.request("/api/auth/logout", {
      method: "POST",
      headers: { ...CSRF, cookie },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { redirect: string };
    assert.ok(body.redirect.includes("end_session"));
    assert.equal(count(t, "sessions"), 0);
    assert.deepEqual(t.oidc.revoked, ["fake-rt-user"]);
    assert.ok(res.headers.getSetCookie().some((c) => c.startsWith("player_session=")));
  });

  it("logout without a session answers 200 with the login redirect", async () => {
    const t = createTestApp();
    const res = await t.app.request("/api/auth/logout", { method: "POST", headers: CSRF });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { redirect: "/api/auth/login" });
  });

  it("builds the callback URL from APP_URL even when the request host differs", async () => {
    const t = createTestApp();
    const { oidcCookie } = await startLogin(t);
    const res = await t.app.request(
      "http://other-host/api/auth/callback?code=admin&state=fake-state",
      { headers: { cookie: oidcCookie } },
    );
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/");
    assert.ok(
      t.oidc.lastCallbackUrl?.toString().startsWith("http://localhost:3000/api/auth/callback"),
    );
  });

  it("clears player_oidc when the callback fails", async () => {
    const t = createTestApp();
    const { oidcCookie } = await startLogin(t);
    const res = await t.app.request("/api/auth/callback?code=admin&state=wrong", {
      headers: { cookie: oidcCookie },
    });
    assert.equal(res.status, 400);
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith("player_oidc="))!;
    assert.ok(cleared);
    assert.match(cleared, /Max-Age=0/i);
  });
});

describe("login unavailable", () => {
  it("answers 502 oidc_unavailable and logs when startLogin rejects", async () => {
    const t = createTestApp();
    t.oidc.startLogin = async () => {
      throw new Error("idp down");
    };
    const res = await t.app.request("/api/auth/login");
    assert.equal(res.status, 502);
    assert.equal(
      ((await res.json()) as { error: { code: string } }).error.code,
      "oidc_unavailable",
    );
    assert.ok(t.log.some((e) => e.event === "auth.login_unavailable"));
  });
});

describe("callback with a missing groups claim", () => {
  it("logs auth.groups_claim_missing and still opens the session", async () => {
    const t = createTestApp();
    delete t.accounts.user!.claims.groups;
    const { oidcCookie } = await startLogin(t);
    const res = await t.app.request("/api/auth/callback?code=user&state=fake-state", {
      headers: { cookie: oidcCookie },
    });
    assert.equal(res.status, 302);
    const entry = t.log.find((e) => e.event === "auth.groups_claim_missing");
    assert.ok(entry);
    assert.equal(entry.data?.claim, "groups");
    assert.equal(count(t, "sessions"), 1);
  });
});
