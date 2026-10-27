import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createApp, type AppDeps } from "../src/app.ts";
import { createSession } from "../src/auth/sessions.ts";
import { upsertUser } from "../src/auth/users.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import { createMediaStorage } from "../src/media/storage.ts";
import { migrate } from "../src/migrations.ts";
import { createFakeOidc, type FakeAccount, type FakeOidc } from "./oidc-fake.ts";

export interface TestAppOptions {
  appUrl?: string;
  accounts?: Record<string, FakeAccount>;
  staticDir?: string;
  env?: Record<string, string>;
  mount?: AppDeps["mount"];
}

export interface LogEntry {
  event: string;
  data?: Record<string, unknown>;
}

export const SESSION_COOKIE = "player_session";

export function createTestApp(opts: TestAppOptions = {}) {
  const config = loadConfig({
    APP_URL: opts.appUrl ?? "http://localhost:3000",
    NODE_ENV: "test",
    OIDC_ISSUER: "http://fake-idp",
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    SESSION_SECRET: "ab".repeat(32),
    ...opts.env,
  });
  const accounts: Record<string, FakeAccount> = opts.accounts ?? {
    admin: {
      claims: { sub: "admin-sub", name: "Admin Test", groups: ["admin"] },
    },
    user: {
      claims: { sub: "user-sub", name: "User Test", groups: ["users"] },
    },
    nobody: {
      claims: { sub: "nobody-sub", name: "Nobody Test", groups: [] },
    },
  };
  const db: DatabaseSync = openDatabase(":memory:");
  migrate(db);
  const tempDir = mkdtempSync(path.join(tmpdir(), "player-test-"));
  const storage = createMediaStorage(tempDir);
  const cleanup = () => rmSync(tempDir, { recursive: true, force: true });
  const oidc: FakeOidc = createFakeOidc(accounts);

  let now = new Date("2026-10-26T12:00:00Z");
  const clock = () => now;
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };

  const log: LogEntry[] = [];
  const app = createApp({
    config,
    db,
    oidc,
    storage,
    now: clock,
    staticDir: opts.staticDir,
    mount: opts.mount,
    log: (event, data) => log.push({ event, data }),
  });

  /** Creates the user and a session directly in the database, returns the Cookie header value. */
  function loginAs(accountId: string): string {
    const account = accounts[accountId];
    if (!account) throw new Error(`unknown account ${accountId}`);
    const claims = account.claims;
    const groups = Array.isArray(claims.groups)
      ? claims.groups.filter((g): g is string => typeof g === "string")
      : [];
    const user = upsertUser(
      db,
      {
        issuer: config.oidc.issuer,
        subject: String(claims.sub),
        displayName: typeof claims.name === "string" ? claims.name : undefined,
        groups,
      },
      now,
    );
    const session = createSession(
      db,
      config.session.secret,
      {
        userId: user.id,
        refreshToken: `fake-rt-${accountId}`,
        idToken: `fake-id-${accountId}`,
        ttlMs: config.session.ttlMs,
      },
      now,
    );
    return `${SESSION_COOKIE}=${session.id}`;
  }

  return {
    app,
    db,
    oidc,
    storage,
    tempDir,
    cleanup,
    accounts,
    config,
    now: clock,
    advance,
    loginAs,
    log,
  };
}
