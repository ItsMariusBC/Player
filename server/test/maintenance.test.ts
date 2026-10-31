import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  createMaintenance,
  runMaintenance,
  scheduleMaintenance,
} from "../src/admin/maintenance.ts";
import { insertTrack } from "../src/catalog/tracks.ts";
import { loadConfig } from "../src/config.ts";
import { createTestApp } from "./helpers.ts";

let t: ReturnType<typeof createTestApp>;
afterEach(() => t?.cleanup());

const H = { "X-Requested-With": "player" };
const DAY = 86_400_000;
const uuid = () => crypto.randomUUID();

function seedTrack(id: string) {
  insertTrack(
    t.db,
    {
      id,
      folderId: null,
      title: id,
      artist: "",
      album: "",
      durationMs: 1000,
      format: "wav",
      sizeBytes: 1,
      sha256: `sha-${id}`,
      coverExt: null,
      status: "ready",
      loudnessLufs: null,
      truePeakDbtp: null,
    },
    t.now(),
  );
}

const HOUR = 3_600_000;

/** Sets the mtime of a directory and of its direct children, relative to the test clock. */
function setAge(dir: string, ageMs: number) {
  const at = new Date(t.now().getTime() - ageMs);
  for (const entry of readdirSync(dir)) utimesSync(path.join(dir, entry), at, at);
  utimesSync(dir, at, at);
}

/** Directories are aged 2 h by default, past the 1 h grace period; pass ageMs to change that. */
function mediaDir(name: string, ageMs = 2 * HOUR): string {
  const dir = path.join(t.tempDir, "media", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "original.wav"), "x");
  setAge(dir, ageMs);
  return dir;
}

function incomingDir(name: string, ageMs = 2 * HOUR): string {
  const dir = path.join(t.tempDir, "incoming", name);
  mkdirSync(dir, { recursive: true });
  setAge(dir, ageMs);
  return dir;
}

function seedImport(id: string, state: "processing" | "ready" | "failed", ageDays: number) {
  t.loginAs("admin");
  const user = t.db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string };
  const at = new Date(t.now().getTime() - ageDays * DAY).toISOString();
  t.db
    .prepare(
      "INSERT INTO imports (id, user_id, filename, state, created_at, updated_at) VALUES (?, ?, 'f.wav', ?, ?, ?)",
    )
    .run(id, user.id, state, at, at);
}

const importIds = () =>
  (t.db.prepare("SELECT id FROM imports ORDER BY id").all() as { id: string }[]).map((r) => r.id);

const deps = () => ({
  db: t.db,
  storage: t.storage,
  now: t.now,
  log: (e: string) => t.log.push({ event: e }),
});

describe("maintenance pass", () => {
  it("removes an orphan media directory and keeps a live one", async () => {
    t = createTestApp();
    const live = uuid();
    const orphan = uuid();
    seedTrack(live);
    const liveDir = mediaDir(live);
    const orphanDir = mediaDir(orphan);
    const result = await runMaintenance(deps());
    assert.equal(result.orphanMedia, 1);
    assert.equal(existsSync(orphanDir), false);
    assert.equal(existsSync(liveDir), true);
  });

  it("handles a missing media directory", async () => {
    t = createTestApp();
    const result = await runMaintenance(deps());
    assert.deepEqual([result.orphanMedia, result.orphanIncoming, result.prunedImports], [0, 0, 0]);
  });

  it("ignores a non-UUID entry and logs it once", async () => {
    t = createTestApp();
    const odd = mediaDir("lost+found");
    const maintenance = createMaintenance(deps());
    assert.equal((await maintenance.run()).orphanMedia, 0);
    await maintenance.run();
    assert.equal(existsSync(odd), true);
    assert.equal(t.log.filter((e) => e.event === "maintenance.unknown_entry").length, 1);
  });

  it("removes an orphan incoming directory and keeps a processing one", async () => {
    t = createTestApp();
    const running = uuid();
    const done = uuid();
    seedImport(running, "processing", 0);
    seedImport(done, "ready", 0);
    const keep = incomingDir(running);
    const orphan = incomingDir(uuid());
    const finished = incomingDir(done);
    const result = await runMaintenance(deps());
    assert.equal(result.orphanIncoming, 2);
    assert.equal(existsSync(keep), true);
    assert.equal(existsSync(orphan), false);
    assert.equal(existsSync(finished), false);
  });

  it("prunes failed and ready imports by age and never processing ones", async () => {
    t = createTestApp();
    seedImport("failed-old", "failed", 31);
    seedImport("failed-new", "failed", 29);
    seedImport("ready-old", "ready", 91);
    seedImport("ready-mid", "ready", 40);
    seedImport("processing-old", "processing", 400);
    const result = await runMaintenance(deps());
    assert.equal(result.prunedImports, 2);
    assert.deepEqual(importIds(), ["failed-new", "processing-old", "ready-mid"]);
  });

  it("keeps a media directory younger than the grace period", async () => {
    t = createTestApp();
    const young = mediaDir(uuid(), 10 * 60_000);
    assert.equal((await runMaintenance(deps())).orphanMedia, 0);
    assert.equal(existsSync(young), true);
    t.advance(2 * HOUR);
    assert.equal((await runMaintenance(deps())).orphanMedia, 1);
    assert.equal(existsSync(young), false);
  });

  it("keeps an incoming directory younger than the grace period even without a row", async () => {
    t = createTestApp();
    const young = incomingDir(uuid(), 10 * 60_000);
    assert.equal((await runMaintenance(deps())).orphanIncoming, 0);
    assert.equal(existsSync(young), true);
  });

  it("honours an injected grace period", async () => {
    t = createTestApp();
    const dir = incomingDir(uuid(), 10 * 60_000);
    assert.equal((await runMaintenance({ ...deps(), graceMs: 60_000 })).orphanIncoming, 1);
    assert.equal(existsSync(dir), false);
  });

  it("keeps an old directory holding a recently written file", async () => {
    t = createTestApp();
    const dir = mediaDir(uuid());
    const file = path.join(dir, "original.wav");
    const recent = new Date(t.now().getTime() - 5 * 60_000);
    utimesSync(file, recent, recent);
    assert.equal((await runMaintenance(deps())).orphanMedia, 0);
    assert.equal(existsSync(dir), true);
  });

  it("keeps a media directory whose track appeared after the snapshot", async () => {
    t = createTestApp();
    const id = uuid();
    const dir = mediaDir(id);
    const result = await runMaintenance({
      ...deps(),
      afterSnapshot: (kind, name) => {
        if (kind === "media" && name === id) seedTrack(id);
      },
    });
    assert.equal(result.orphanMedia, 0);
    assert.equal(existsSync(dir), true);
  });

  it("keeps an incoming directory whose import started after the snapshot", async () => {
    t = createTestApp();
    const id = uuid();
    const dir = incomingDir(id);
    const result = await runMaintenance({
      ...deps(),
      afterSnapshot: (kind, name) => {
        if (kind === "incoming" && name === id) seedImport(id, "processing", 0);
      },
    });
    assert.equal(result.orphanIncoming, 0);
    assert.equal(existsSync(dir), true);
  });

  it("carries on with the pruning phase when a listing fails", async () => {
    t = createTestApp();
    seedImport("failed-old", "failed", 31);
    const orphan = incomingDir(uuid());
    const storage = {
      ...t.storage,
      listMedia: async () => {
        throw new Error("EIO");
      },
    };
    const result = await runMaintenance({ ...deps(), storage });
    assert.equal(result.orphanMedia, 0);
    assert.equal(result.orphanIncoming, 1);
    assert.equal(result.prunedImports, 1);
    assert.equal(existsSync(orphan), false);
    assert.equal(t.log.filter((e) => e.event === "maintenance.list_failed").length, 1);
  });

  it("ignores non-UUID incoming entries and logs them once", async () => {
    t = createTestApp();
    const odd = incomingDir("not-a-uuid");
    const maintenance = createMaintenance(deps());
    assert.equal((await maintenance.run()).orphanIncoming, 0);
    await maintenance.run();
    assert.equal(existsSync(odd), true);
    assert.equal(t.log.filter((e) => e.event === "maintenance.unknown_entry").length, 1);
  });

  it("logs a failing removal and carries on", async () => {
    t = createTestApp();
    const bad = uuid();
    const good = uuid();
    mediaDir(bad);
    const goodDir = mediaDir(good);
    const storage = {
      ...t.storage,
      removeTrack: async (id: string) => {
        if (id === bad) throw new Error("EBUSY");
        await t.storage.removeTrack(id);
      },
    };
    const result = await runMaintenance({ ...deps(), storage });
    assert.equal(result.orphanMedia, 1);
    assert.equal(existsSync(goodDir), false);
    assert.equal(t.log.filter((e) => e.event === "maintenance.remove_failed").length, 1);
    assert.ok(t.log.some((e) => e.event === "maintenance.run"));
  });

  it("shares one pass between concurrent calls", async () => {
    t = createTestApp();
    let calls = 0;
    const storage = {
      ...t.storage,
      listMedia: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return [];
      },
    };
    const maintenance = createMaintenance({ ...deps(), storage });
    assert.equal(maintenance.status().running, false);
    const a = maintenance.run();
    const b = maintenance.run();
    assert.equal(a, b);
    assert.equal(maintenance.status().running, true);
    await a;
    assert.equal(calls, 1);
    const status = maintenance.status();
    assert.equal(status.running, false);
    assert.equal(status.lastRunAt, t.now().toISOString());
    assert.ok(status.lastResult);
    await maintenance.run();
    assert.equal(calls, 2);
  });
});

describe("maintenance routes", () => {
  it("forbids the user role", async () => {
    t = createTestApp();
    const cookie = t.loginAs("user");
    const get = await t.app.request("/api/admin/maintenance", { headers: { cookie, ...H } });
    const post = await t.app.request("/api/admin/maintenance/run", {
      method: "POST",
      headers: { cookie, ...H },
    });
    assert.equal(get.status, 403);
    assert.equal(post.status, 403);
  });

  it("runs a pass, records the event and reports the status", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    mediaDir(uuid());
    const before = await t.app.request("/api/admin/maintenance", { headers: { cookie, ...H } });
    assert.deepEqual(await before.json(), { lastRunAt: null, lastResult: null, running: false });
    const res = await t.app.request("/api/admin/maintenance/run", {
      method: "POST",
      headers: { cookie, ...H },
    });
    assert.equal(res.status, 200);
    const result = (await res.json()) as Record<string, number>;
    assert.equal(result.orphanMedia, 1);
    const event = t.db
      .prepare("SELECT detail FROM admin_events WHERE action = 'maintenance_run'")
      .get() as { detail: string };
    assert.deepEqual(JSON.parse(event.detail), result);
    const after = (await (
      await t.app.request("/api/admin/maintenance", { headers: { cookie, ...H } })
    ).json()) as { lastRunAt: string; lastResult: unknown; running: boolean };
    assert.equal(after.lastRunAt, t.now().toISOString());
    assert.deepEqual(after.lastResult, result);
    assert.equal(after.running, false);
  });
});

describe("maintenance schedule", () => {
  const fake = () => {
    const timers: { fn: () => void; ms: number; unref: boolean; cleared: boolean }[] = [];
    return {
      timers,
      setInterval: (fn: () => void, ms: number) => {
        const timer = { fn, ms, unref: false, cleared: false };
        timers.push(timer);
        return {
          unref: () => {
            timer.unref = true;
          },
          timer,
        };
      },
      clearInterval: (handle: { timer: { cleared: boolean } }) => {
        handle.timer.cleared = true;
      },
    };
  };

  it("runs a pass at each tick on an unref'd timer and stops on request", async () => {
    let runs = 0;
    const maintenance = {
      run: async () => {
        runs += 1;
        return { orphanMedia: 0, orphanIncoming: 0, prunedImports: 0, durationMs: 0 };
      },
      status: () => ({ lastRunAt: null, lastResult: null, running: false }),
    };
    const f = fake();
    const stop = scheduleMaintenance(maintenance, { intervalMs: 5000, ...f });
    assert.equal(f.timers.length, 1);
    assert.equal(f.timers[0]!.ms, 5000);
    assert.equal(f.timers[0]!.unref, true);
    f.timers[0]!.fn();
    f.timers[0]!.fn();
    assert.equal(runs, 2);
    stop();
    assert.equal(f.timers[0]!.cleared, true);
  });

  it("logs a failing pass and keeps going", async () => {
    const events: string[] = [];
    const maintenance = {
      run: async () => {
        throw new Error("boom");
      },
      status: () => ({ lastRunAt: null, lastResult: null, running: false }),
    };
    const f = fake();
    scheduleMaintenance(maintenance, { intervalMs: 1, ...f, log: (e) => events.push(e) });
    f.timers[0]!.fn();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(events, ["maintenance.failed"]);
  });

  it("schedules nothing for an interval of 0", () => {
    const f = fake();
    const stop = scheduleMaintenance(
      { run: async () => ({}) as never, status: () => ({}) as never },
      { intervalMs: 0, ...f },
    );
    assert.equal(f.timers.length, 0);
    stop();
  });
});

describe("MAINTENANCE_INTERVAL_HOURS", () => {
  const env = {
    APP_URL: "http://localhost:3000",
    NODE_ENV: "test",
    OIDC_ISSUER: "http://fake-idp",
    OIDC_CLIENT_ID: "c",
    OIDC_CLIENT_SECRET: "s",
    SESSION_SECRET: "ab".repeat(32),
  };
  it("defaults to 24, accepts 0 and rejects invalid values", () => {
    assert.equal(loadConfig(env).maintenanceIntervalHours, 24);
    assert.equal(
      loadConfig({ ...env, MAINTENANCE_INTERVAL_HOURS: "0" }).maintenanceIntervalHours,
      0,
    );
    assert.equal(
      loadConfig({ ...env, MAINTENANCE_INTERVAL_HOURS: "6" }).maintenanceIntervalHours,
      6,
    );
    for (const bad of ["-1", "1.5", "abc"]) {
      assert.throws(
        () => loadConfig({ ...env, MAINTENANCE_INTERVAL_HOURS: bad }),
        /MAINTENANCE_INTERVAL_HOURS/,
      );
    }
  });
});
