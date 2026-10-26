import { serve } from "@hono/node-server";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { createOidcAdapter } from "./auth/oidc.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { migrate } from "./migrations.ts";

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
const oidc = await createOidcAdapter(config.oidc, {
  allowInsecure: config.nodeEnv !== "production",
});
const log = (event: string, data?: Record<string, unknown>) =>
  console.log(JSON.stringify({ event, ...data }));

const app = createApp({ config, db, oidc, staticDir: "dist", log });
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
