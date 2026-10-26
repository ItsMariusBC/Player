import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError, loadConfig } from "../src/config.ts";

const SECRET = "ab".repeat(32);

const minimal = {
  APP_URL: "https://player.example",
  OIDC_ISSUER: "https://auth.example/application/o/player/",
  OIDC_CLIENT_ID: "player",
  OIDC_CLIENT_SECRET: "shh",
  SESSION_SECRET: SECRET,
};

describe("loadConfig", () => {
  it("applies defaults for optional variables", () => {
    const config = loadConfig(minimal);
    assert.equal(config.port, 8080);
    assert.equal(config.dataDir, "/data");
    assert.equal(config.oidc.groupAdmin, "admin");
    assert.equal(config.session.ttlMs, 43_200_000);
    assert.equal(config.session.groupsRecheckMs, 900_000);
    assert.equal(config.trustProxy, false);
    assert.equal(config.nodeEnv, "production");
    assert.equal(config.session.secret.length, 32);
  });

  it("rejects a missing OIDC_ISSUER", () => {
    const { OIDC_ISSUER: _omitted, ...env } = minimal;
    assert.throws(
      () => loadConfig(env),
      (error) => error instanceof ConfigError && error.message.includes("OIDC_ISSUER"),
    );
  });

  it("rejects a SESSION_SECRET that is not 32 bytes", () => {
    assert.throws(
      () => loadConfig({ ...minimal, SESSION_SECRET: "0123456789" }),
      (error) => error instanceof ConfigError && error.message.includes("32"),
    );
  });

  it("requires https for APP_URL in production", () => {
    assert.throws(
      () => loadConfig({ ...minimal, NODE_ENV: "production", APP_URL: "http://player.example" }),
      (error) => error instanceof ConfigError && error.message.includes("https"),
    );
  });

  it("accepts http on localhost in development", () => {
    const config = loadConfig({
      ...minimal,
      NODE_ENV: "development",
      APP_URL: "http://localhost:3000",
    });
    assert.equal(config.appUrl.origin, "http://localhost:3000");
  });

  it("accepts a base64 SESSION_SECRET", () => {
    const config = loadConfig({
      ...minimal,
      SESSION_SECRET: Buffer.alloc(32, 7).toString("base64"),
    });
    assert.equal(config.session.secret.length, 32);
  });

  it("refuses DEV_BYPASS_LOGIN with an https APP_URL", () => {
    assert.throws(
      () =>
        loadConfig({
          ...minimal,
          NODE_ENV: "development",
          APP_URL: "https://player.example",
          DEV_BYPASS_LOGIN: "true",
        }),
      (error) => error instanceof ConfigError && error.message.includes("DEV_BYPASS_LOGIN"),
    );
  });

  it("accepts DEV_BYPASS_LOGIN with an http APP_URL", () => {
    const config = loadConfig({
      ...minimal,
      NODE_ENV: "development",
      APP_URL: "http://localhost:3000",
      DEV_BYPASS_LOGIN: "true",
    });
    assert.equal(config.devBypass, true);
  });
});
