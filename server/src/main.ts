import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { createOidcAdapter } from "./auth/oidc.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { createImportQueue, recoverStaleImports } from "./admin/imports.ts";
import { createTrackLocks } from "./admin/track-edit.ts";
import { createHealth } from "./health.ts";
import { createMaintenance, scheduleMaintenance } from "./admin/maintenance.ts";
import { createMediaStorage } from "./media/storage.ts";
import { createProviders } from "./metadata/providers.ts";
import { createMetadataSearch } from "./metadata/search.ts";
import { migrate } from "./migrations.ts";
import { retry } from "./retry.ts";

function readConfig() {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Configuration error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const db = openDatabase(join(config.dataDir, "player.sqlite"));
migrate(db);
const log = (event: string, data?: Record<string, unknown>) =>
  console.log(JSON.stringify({ event, ...data }));

// Delays 1, 2, 4, then 8 s: 11 attempts, 63 s of waiting in total.
async function discoverOidc() {
  try {
    return await retry(
      () =>
        createOidcAdapter(config.oidc, {
          allowInsecure: config.nodeEnv !== "production",
        }),
      {
        attempts: 11,
        baseDelayMs: 1000,
        maxDelayMs: 8000,
        onRetry: (error, attempt, delayMs) =>
          log("oidc.discovery_retry", {
            attempt,
            delayMs,
            error: error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
          }),
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
    console.error(`OIDC discovery failed after retries: ${reason}`);
    process.exit(1);
  }
}

const oidc = await discoverOidc();

const storage = createMediaStorage(config.dataDir);
await recoverStaleImports({ db, storage, log });
const maintenance = createMaintenance({ db, storage, log });
scheduleMaintenance(maintenance, {
  intervalMs: config.maintenanceIntervalHours * 3_600_000,
  log,
});

// Same relative path from server/src and dist/server.
function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
const startedAt = new Date();
const version = appVersion();
const userAgent = `Player/${version} (${config.appUrl.origin})`;
const metadata = createMetadataSearch({
  providers: createProviders({ fetch: globalThis.fetch, userAgent }),
  now: () => new Date(),
  log,
  userAgent,
});
const trackLocks = createTrackLocks();
const imports = createImportQueue({
  db,
  storage,
  trackLocks,
  log,
  ffmpegPath: config.ffmpegPath,
  download: { maxBytes: config.maxUploadBytes, userAgent },
  cover: { userAgent },
});
const health = createHealth({
  db,
  dataDir: config.dataDir,
  minFreeBytes: config.minFreeBytes,
  version,
  startedAt,
  ffmpegAvailable: async () => (await imports.loudnessStatus()).available,
  maintenance,
});
const app = createApp({
  config,
  db,
  oidc,
  storage,
  imports,
  trackLocks,
  health,
  metadata,
  maintenance,
  staticDir: "dist",
  log,
});
const server = serve({ fetch: app.fetch, port: config.port }, (info) =>
  log("listening", { port: info.port }),
);

// Not awaited: a slow pass (large data directory) must not delay readiness.
void maintenance
  .run()
  .catch((error) =>
    log("maintenance.failed", { error: error instanceof Error ? error.name : "unknown" }),
  );

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
