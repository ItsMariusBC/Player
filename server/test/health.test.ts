import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { HealthReport } from "../src/health.ts";
import { createTestApp } from "./helpers.ts";

const H = { "X-Requested-With": "fetch" };
let t: ReturnType<typeof createTestApp>;
afterEach(() => t?.cleanup());

const MB = 1024 * 1024;
const disk = (freeMb: number) => async () => ({
  bsize: MB,
  blocks: 10_000,
  bavail: freeMb,
});
const detail = async (cookie: string) =>
  t.app.request("/api/admin/health", { headers: { cookie, ...H } });

describe("health", () => {
  it("is ok with enough space and every migration applied", async () => {
    t = createTestApp({ statfs: disk(1000), version: "1.2.3" });
    const res = await detail(t.loginAs("admin"));
    assert.equal(res.status, 200);
    const body = (await res.json()) as HealthReport;
    assert.equal(body.status, "ok");
    assert.deepEqual(body.reasons, []);
    assert.equal(body.version, "1.2.3");
    assert.equal(body.uptimeSeconds, 0);
    assert.equal(body.migrations.applied, body.migrations.expected);
    assert.deepEqual(body.disk, {
      freeBytes: 1000 * MB,
      totalBytes: 10_000 * MB,
    });
    assert.deepEqual(body.ffmpeg, { available: true });
    assert.deepEqual(body.maintenance, { lastRunAt: null, lastResult: null });
    const healthz = await t.app.request("/healthz");
    assert.equal(healthz.status, 200);
    assert.equal(await healthz.text(), "ok\n");
  });

  it("reports uptime from the start time", async () => {
    t = createTestApp({ statfs: disk(1000) });
    t.advance(90_500);
    const body = (await (await detail(t.loginAs("admin"))).json()) as HealthReport;
    assert.equal(body.uptimeSeconds, 90);
  });

  it("is degraded on low disk space", async () => {
    t = createTestApp({ statfs: disk(100) });
    const body = (await (await detail(t.loginAs("admin"))).json()) as HealthReport;
    assert.equal(body.status, "degraded");
    assert.deepEqual(body.reasons, ["low_disk"]);
    const healthz = await t.app.request("/healthz");
    assert.equal(healthz.status, 503);
    assert.equal(await healthz.text(), "degraded\n");
  });

  it("honours MIN_FREE_MB", async () => {
    t = createTestApp({ statfs: disk(100), env: { MIN_FREE_MB: "50" } });
    const body = (await (await detail(t.loginAs("admin"))).json()) as HealthReport;
    assert.equal(body.status, "ok");
  });

  it("is degraded when the data directory cannot be read", async () => {
    t = createTestApp({
      statfs: async () => {
        throw new Error("ENOENT");
      },
    });
    const body = (await (await detail(t.loginAs("admin"))).json()) as HealthReport;
    assert.equal(body.status, "degraded");
    assert.deepEqual(body.reasons, ["data_dir_unavailable"]);
    assert.equal(body.disk, null);
    assert.equal((await t.app.request("/healthz")).status, 503);
  });

  it("is degraded when migrations are pending", async () => {
    t = createTestApp({ statfs: disk(1000) });
    t.db
      .prepare("DELETE FROM schema_migrations WHERE id = (SELECT MAX(id) FROM schema_migrations)")
      .run();
    const body = (await (await detail(t.loginAs("admin"))).json()) as HealthReport;
    assert.deepEqual(body.reasons, ["migrations_pending"]);
    assert.equal(body.migrations.applied, body.migrations.expected - 1);
    assert.equal((await t.app.request("/healthz")).status, 503);
  });

  it("lists several reasons at once", async () => {
    t = createTestApp({ statfs: disk(1), migrationsExpected: 999 });
    const body = (await (await detail(t.loginAs("admin"))).json()) as HealthReport;
    assert.deepEqual(body.reasons, ["migrations_pending", "low_disk"]);
  });

  it("counts tracks, processing imports and pending requests", async () => {
    t = createTestApp({ statfs: disk(1000) });
    const cookie = t.loginAs("user");
    const userId = (t.db.prepare("SELECT id FROM users").get() as { id: string }).id;
    const ts = t.now().toISOString();
    for (const id of ["a", "b"]) {
      t.db
        .prepare(
          "INSERT INTO tracks (id, title, format, size_bytes, sha256, created_at, updated_at) VALUES (?, ?, 'wav', 1, ?, ?, ?)",
        )
        .run(id, id, `sha-${id}`, ts, ts);
    }
    for (const [id, state] of [
      ["i1", "processing"],
      ["i2", "processing"],
      ["i3", "ready"],
    ]) {
      t.db
        .prepare(
          "INSERT INTO imports (id, user_id, filename, state, created_at, updated_at) VALUES (?, ?, 'f', ?, ?, ?)",
        )
        .run(id, userId, state, ts, ts);
    }
    for (const [id, status] of [
      ["r1", "pending"],
      ["r2", "accepted"],
      ["r3", "pending"],
    ]) {
      t.db
        .prepare(
          "INSERT INTO song_requests (id, user_id, title, source, status, created_at, updated_at) VALUES (?, ?, 't', 'manual', ?, ?, ?)",
        )
        .run(id, userId, status, ts, ts);
    }
    void cookie;
    const body = (await (await detail(t.loginAs("admin"))).json()) as HealthReport;
    assert.deepEqual(body.counts, {
      tracks: 2,
      importsProcessing: 2,
      requestsPending: 2,
    });
  });

  it("shows the ffmpeg availability and the last maintenance pass", async () => {
    t = createTestApp({ statfs: disk(1000), ffmpegAvailable: false });
    await t.maintenance.run();
    const body = (await (await detail(t.loginAs("admin"))).json()) as HealthReport;
    assert.deepEqual(body.ffmpeg, { available: false });
    assert.equal(body.maintenance.lastRunAt, t.now().toISOString());
    assert.ok(body.maintenance.lastResult);
  });

  it("keeps the detail admin-only", async () => {
    t = createTestApp();
    assert.equal((await detail(t.loginAs("user"))).status, 403);
    const anonymous = await t.app.request("/api/admin/health", { headers: H });
    assert.equal(anonymous.status, 401);
  });
});
