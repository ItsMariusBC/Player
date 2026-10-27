import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { MediaStorage } from "../media/storage.ts";

export interface MaintenanceResult {
  orphanMedia: number;
  orphanIncoming: number;
  prunedImports: number;
  durationMs: number;
}

export interface MaintenanceStatus {
  lastRunAt: string | null;
  lastResult: MaintenanceResult | null;
  running: boolean;
}

export interface Maintenance {
  /** Runs one pass; a call during a pass returns that pass's promise. */
  run(): Promise<MaintenanceResult>;
  status(): MaintenanceStatus;
}

type Log = (event: string, data?: Record<string, unknown>) => void;

const DAY_MS = 86_400_000;
/** An orphan directory younger than this is left alone: an import may be about to claim it. */
export const MAINTENANCE_GRACE_MS = 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MaintenanceDeps {
  db: DatabaseSync;
  storage: MediaStorage;
  now?: () => Date;
  log?: Log;
  /** Failed imports older than this are deleted (default 30 days). */
  maxImportAgeDays?: number;
  /** Ready imports older than this are deleted (default 90 days). */
  maxHistoryDays?: number;
  /** Directories modified more recently than this are never removed (default 1 h). */
  graceMs?: number;
  /** Test seam: called after a candidate passed the age check, right before its fresh query. */
  afterSnapshot?: (kind: "media" | "incoming", name: string) => void | Promise<void>;
}

/**
 * One maintenance pass: removes media directories without a track, incoming directories without
 * a processing import, and old finished imports. A directory is only removed when its name is a
 * UUID, it (and its direct children) is older than the grace period, and a fresh query right
 * before the removal confirms no row claims it. A failing listing or removal is logged and skipped.
 */
export async function runMaintenance(
  deps: MaintenanceDeps & { warned?: Set<string> },
): Promise<MaintenanceResult> {
  const { db, storage, log } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const graceMs = deps.graceMs ?? MAINTENANCE_GRACE_MS;
  const started = Date.now();
  const warned = deps.warned ?? new Set<string>();
  const errorName = (error: unknown) => (error instanceof Error ? error.name : "unknown");
  const ids = (sql: string) =>
    new Set((db.prepare(sql).all() as { id: string }[]).map((r) => r.id));
  const exists = (sql: string, id: string) => db.prepare(sql).get(id) !== undefined;

  // Listings first, snapshots after: a row created in between is in the snapshot or the fresh query.
  const list = async (kind: "media" | "incoming") => {
    try {
      return await (kind === "media" ? storage.listMedia() : storage.listIncoming());
    } catch (error) {
      log?.("maintenance.list_failed", { kind, error: errorName(error) });
      return null;
    }
  };
  const mediaNames = await list("media");
  const incomingNames = await list("incoming");

  /** True when the directory and its direct children were all modified before the cutoff. */
  const isOld = async (dir: string) => {
    let newest = (await stat(dir)).mtimeMs;
    for (const child of await readdir(dir)) {
      newest = Math.max(newest, (await stat(path.join(dir, child))).mtimeMs);
    }
    return now.getTime() - newest > graceMs;
  };

  const sweep = async (
    kind: "media" | "incoming",
    names: string[],
    dirOf: (name: string) => string,
    claimed: Set<string>,
    claimedNow: string,
    remove: (name: string) => Promise<void>,
  ) => {
    let removed = 0;
    for (const name of names) {
      if (!UUID.test(name)) {
        if (!warned.has(`${kind}/${name}`)) {
          warned.add(`${kind}/${name}`);
          log?.("maintenance.unknown_entry", { kind, name });
        }
        continue;
      }
      if (claimed.has(name)) continue;
      try {
        if (!(await isOld(dirOf(name)))) continue;
        await deps.afterSnapshot?.(kind, name);
        if (exists(claimedNow, name)) continue;
        await remove(name);
        removed += 1;
      } catch (error) {
        log?.("maintenance.remove_failed", { kind, name, error: errorName(error) });
      }
    }
    return removed;
  };

  let orphanMedia = 0;
  if (mediaNames) {
    const tracks = ids("SELECT id FROM tracks");
    orphanMedia = await sweep(
      "media",
      mediaNames,
      (name) => storage.mediaPath(name),
      tracks,
      "SELECT 1 FROM tracks WHERE id = ?",
      (name) => storage.removeTrack(name),
    );
  }

  let orphanIncoming = 0;
  if (incomingNames) {
    const processing = ids("SELECT id FROM imports WHERE state = 'processing'");
    orphanIncoming = await sweep(
      "incoming",
      incomingNames,
      (name) => storage.incomingPath(name),
      processing,
      "SELECT 1 FROM imports WHERE id = ? AND state = 'processing'",
      (name) => storage.removeIncoming(name),
    );
  }

  const failedCutoff = new Date(now.getTime() - (deps.maxImportAgeDays ?? 30) * DAY_MS);
  const readyCutoff = new Date(now.getTime() - (deps.maxHistoryDays ?? 90) * DAY_MS);
  const prune = (state: string, cutoff: Date) =>
    Number(
      db
        .prepare("DELETE FROM imports WHERE state = ? AND updated_at < ?")
        .run(state, cutoff.toISOString()).changes,
    );
  const prunedImports = prune("failed", failedCutoff) + prune("ready", readyCutoff);

  const result = { orphanMedia, orphanIncoming, prunedImports, durationMs: Date.now() - started };
  log?.("maintenance.run", { ...result });
  return result;
}

export function createMaintenance(deps: MaintenanceDeps): Maintenance {
  const now = deps.now ?? (() => new Date());
  const warned = new Set<string>();
  let inFlight: Promise<MaintenanceResult> | null = null;
  let lastRunAt: string | null = null;
  let lastResult: MaintenanceResult | null = null;
  return {
    run() {
      if (inFlight) return inFlight;
      const pass = runMaintenance({ ...deps, warned })
        .then((result) => {
          lastRunAt = now().toISOString();
          lastResult = result;
          return result;
        })
        .finally(() => {
          inFlight = null;
        });
      inFlight = pass;
      return pass;
    },
    status: () => ({ lastRunAt, lastResult, running: inFlight !== null }),
  };
}

/**
 * Runs a pass every intervalMs; returns a function that stops the schedule. An interval of 0
 * (or less) schedules nothing. A failing pass is logged and the schedule continues.
 */
export function scheduleMaintenance(
  maintenance: Maintenance,
  options: {
    intervalMs: number;
    setInterval?: (fn: () => void, ms: number) => { unref?: () => unknown };
    clearInterval?: (handle: never) => void;
    log?: Log;
  },
): () => void {
  if (!(options.intervalMs > 0)) return () => {};
  const set = options.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clear = (options.clearInterval ?? clearInterval) as (handle: unknown) => void;
  const handle = set(() => {
    maintenance.run().catch((error) => {
      options.log?.("maintenance.failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
    });
  }, options.intervalMs);
  handle.unref?.();
  return () => clear(handle);
}
