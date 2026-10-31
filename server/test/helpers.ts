import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createImportQueue } from "../src/admin/imports.ts";
import { createHealth, type StatfsFn } from "../src/health.ts";
import { createMaintenance } from "../src/admin/maintenance.ts";
import { createApp, type AppDeps } from "../src/app.ts";
import { createSession } from "../src/auth/sessions.ts";
import { upsertUser } from "../src/auth/users.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import type { Loudness } from "../src/media/loudness.ts";
import { createMediaStorage } from "../src/media/storage.ts";
import { createMetadataSearch, type MetadataProvider } from "../src/metadata/search.ts";
import { migrate } from "../src/migrations.ts";
import { createFakeOidc, type FakeAccount, type FakeOidc } from "./oidc-fake.ts";

export interface TestAppOptions {
  appUrl?: string;
  accounts?: Record<string, FakeAccount>;
  staticDir?: string;
  env?: Record<string, string>;
  mount?: AppDeps["mount"];
  /** Loudness measurement used by imports and the backfill; ffmpeg never runs in tests. */
  measure?: (file: string) => Promise<Loudness | null>;
  /** Whether ffmpeg counts as available (default true). */
  ffmpegAvailable?: boolean | (() => Promise<boolean>);
  /** Disk stats used by the health check; defaults to plenty of free space. */
  statfs?: StatfsFn;
  /** Disk probe timeout of the health check, in ms. */
  statfsTimeoutMs?: number;
  version?: string;
  /** Migrations the code is expected to have applied (default: all of them). */
  migrationsExpected?: number;
  /** Leaves `metadata` out of the app deps, as when no provider is configured. */
  withoutMetadata?: boolean;
  /** Import by URL: fetch/resolve for the download; nothing reaches the network. */
  download?: {
    fetch?: typeof globalThis.fetch;
    resolve?: (host: string) => Promise<string[]>;
  };
  /** Metadata providers and the cover guard's fetch/resolve; nothing reaches the network. */
  metadata?: {
    providers?: MetadataProvider[];
    fetch?: typeof globalThis.fetch;
    resolve?: (host: string) => Promise<string[]>;
    /** Rate-limit wait; advances the test clock by default, so no test really sleeps. */
    sleep?: (ms: number) => Promise<void>;
  };
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
  const logger = (event: string, data?: Record<string, unknown>) => log.push({ event, data });
  const imports = createImportQueue({
    db,
    storage,
    log: logger,
    now: clock,
    measure: opts.measure ?? (async () => null),
    ffmpegAvailable:
      typeof opts.ffmpegAvailable === "function"
        ? opts.ffmpegAvailable
        : async () => opts.ffmpegAvailable ?? true,
    cover: {
      fetch:
        opts.metadata?.fetch ??
        (async () => {
          throw new Error("network disabled in tests");
        }),
      resolve: opts.metadata?.resolve ?? (async () => ["93.184.216.34"]),
    },
    download: {
      maxBytes: config.maxUploadBytes,
      fetch:
        opts.download?.fetch ??
        (async () => {
          throw new Error("network disabled in tests");
        }),
      resolve: opts.download?.resolve ?? (async () => ["93.184.216.34"]),
    },
  });
  const maintenance = createMaintenance({ db, storage, now: clock, log: logger });
  const health = createHealth({
    db,
    dataDir: tempDir,
    statfs:
      opts.statfs ??
      (async () => ({
        bsize: 1024,
        blocks: 1_000_000_000,
        bavail: 500_000_000,
      })),
    minFreeBytes: config.minFreeBytes,
    version: opts.version ?? "0.0.0-test",
    startedAt: clock(),
    ffmpegAvailable: async () => (await imports.loudnessStatus()).available,
    maintenance,
    migrationsExpected: opts.migrationsExpected,
    statfsTimeoutMs: opts.statfsTimeoutMs,
    now: clock,
  });
  const metadata = createMetadataSearch({
    providers: opts.metadata?.providers ?? [],
    now: clock,
    log: logger,
    fetch:
      opts.metadata?.fetch ??
      (async () => {
        throw new Error("network disabled in tests");
      }),
    resolve: opts.metadata?.resolve ?? (async () => ["93.184.216.34"]),
    sleep: opts.metadata?.sleep ?? (async (ms) => advance(ms)),
  });
  const app = createApp({
    metadata: opts.withoutMetadata ? undefined : metadata,
    config,
    db,
    oidc,
    storage,
    imports,
    maintenance,
    health,
    now: clock,
    staticDir: opts.staticDir,
    mount: opts.mount,
    log: logger,
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
    imports,
    maintenance,
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
