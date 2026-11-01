import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 30_000,
  reporter: [["list"], ["junit", { outputFile: "reports/e2e.xml" }], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYER_TEST_URL || "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // No animated WebGL gradient nor motion: the CI runners have no GPU and the software
    // renderer made every interaction take tens of seconds.
    reducedMotion: "reduce",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYER_TEST_URL
    ? undefined
    : [
        {
          command: "node server/dev/mock-oidc.ts",
          url: "http://127.0.0.1:3002/.well-known/openid-configuration",
          env: { MOCK_OIDC_PORT: "3002" },
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: process.env.PLAYER_SKIP_BUILD
            ? "sh scripts/e2e/start-server.sh"
            : "yarn build && sh scripts/e2e/start-server.sh",
          url: "http://127.0.0.1:4173/healthz",
          env: {
            NODE_ENV: "test",
            APP_URL: "http://127.0.0.1:4173",
            PORT: "4173",
            DATA_DIR: "./.data/e2e",
            OIDC_ISSUER: "http://localhost:3002",
            OIDC_CLIENT_ID: "player-dev",
            OIDC_CLIENT_SECRET: "player-dev-secret",
            SESSION_SECRET: "0123456789abcdef".repeat(4),
            OIDC_GROUPS_CLAIM: "groups",
          },
          reuseExistingServer: false,
          timeout: 180_000,
        },
      ],
});
