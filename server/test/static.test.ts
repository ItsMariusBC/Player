import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createTestApp } from "./helpers.ts";

describe("static files", () => {
  let dir: string;
  let app: ReturnType<typeof createTestApp>["app"];

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "player-static-"));
    mkdirSync(join(dir, "assets"));
    mkdirSync(join(dir, "server"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>Player</title>");
    writeFileSync(join(dir, "assets", "app.js"), "console.log(1);");
    writeFileSync(join(dir, ".secret"), "secret");
    writeFileSync(join(dir, "server", "main.js"), "// server code");
    writeFileSync(join(dir, "favicon.ico"), "ico");
    app = createTestApp({ staticDir: dir }).app;
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  function assertHeaders(res: Response) {
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  }

  it("serves index.html at / with no-cache", async () => {
    const res = await app.request("/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(res.headers.get("cache-control"), "no-cache");
    assertHeaders(res);
  });

  it("serves assets as immutable", async () => {
    const res = await app.request("/assets/app.js");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assertHeaders(res);
  });

  it("returns 404 for a missing asset", async () => {
    const res = await app.request("/assets/missing.js");
    assert.equal(res.status, 404);
    assertHeaders(res);
  });

  it("returns 404 for a missing extensionless asset", async () => {
    const res = await app.request("/assets/missing");
    assert.equal(res.status, 404);
    assertHeaders(res);
  });

  it("returns a JSON 404 for unknown API routes", async () => {
    const res = await app.request("/api/nope", { headers: { "X-Requested-With": "player" } });
    assert.equal(res.status, 404);
    assert.deepEqual((await res.json()).error.code, "not_found");
    assertHeaders(res);
  });

  it("falls back to index.html for extensionless routes", async () => {
    const res = await app.request("/quelconque/route");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>Player<\/title>/);
    assert.equal(res.headers.get("cache-control"), "no-cache");
    assertHeaders(res);
  });

  it("returns 404 for dotfiles", async () => {
    const res = await app.request("/.secret");
    assert.equal(res.status, 404);
    assertHeaders(res);
  });

  it("returns 404 for anything under /server/", async () => {
    const res = await app.request("/server/main.js");
    assert.equal(res.status, 404);
    assertHeaders(res);
  });

  it("serves root files as-is", async () => {
    const res = await app.request("/favicon.ico");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ico");
    assertHeaders(res);
  });

  it("never serves index.html for /api/*", async () => {
    const res = await app.request("/api/session", { headers: { "X-Requested-With": "fetch" } });
    assert.equal(res.status, 401);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    assertHeaders(res);
  });

  it("keeps /healthz out of the static handler", async () => {
    const res = await app.request("/healthz");
    assert.equal(await res.text(), "ok\n");
  });
});
