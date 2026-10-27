import { serve } from "@hono/node-server";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { createOidcAdapter } from "./auth/oidc.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { createImportQueue } from "./admin/imports.ts";
import { createMediaStorage } from "./media/storage.ts";
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
const app = createApp({
  config,
  db,
  oidc,
  storage,
  imports: createImportQueue({ db, storage, log }),
  staticDir: "dist",
  log,
});
const server = serve({ fetch: app.fetch, port: config.port }, (info) =>
  log("listening", { port: info.port }),
);

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
