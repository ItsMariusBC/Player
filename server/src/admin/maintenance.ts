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
}

/**
 * One maintenance pass: removes media directories without a track, incoming directories without
 * a processing import, and old finished imports. A failing removal is logged and skipped.
 */
export async function runMaintenance(
  deps: MaintenanceDeps & { warned?: Set<string> },
): Promise<MaintenanceResult> {
  const { db, storage, log } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const started = Date.now();
  const warned = deps.warned ?? new Set<string>();
  const ids = (sql: string) =>
    new Set((db.prepare(sql).all() as { id: string }[]).map((r) => r.id));

  // A file is published before its track row exists: while an import is processing, a row-less
  // media directory may be that import's, so media is left alone until none is running.
  const processing = ids("SELECT id FROM imports WHERE state = 'processing'");
  let orphanMedia = 0;
  if (processing.size === 0) {
    const tracks = ids("SELECT id FROM tracks");
    for (const name of await storage.listMedia()) {
      if (!UUID.test(name)) {
        if (!warned.has(name)) {
          warned.add(name);
          log?.("maintenance.unknown_entry", { name });
        }
        continue;
      }
      if (tracks.has(name)) continue;
      try {
        await storage.removeTrack(name);
        orphanMedia += 1;
      } catch (error) {
        log?.("maintenance.remove_failed", {
          kind: "media",
          name,
          error: error instanceof Error ? error.name : "unknown",
        });
      }
    }
  }

  let orphanIncoming = 0;
  for (const name of await storage.listIncoming()) {
    if (processing.has(name)) continue;
    try {
      await storage.removeIncoming(name);
      orphanIncoming += 1;
    } catch (error) {
      log?.("maintenance.remove_failed", {
        kind: "incoming",
        name,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
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
