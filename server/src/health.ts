import { statfs as nodeStatfs } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import type { MaintenanceStatus } from "./admin/maintenance.ts";
import { MIGRATIONS } from "./migrations.ts";

export type StatfsFn = (path: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;

export type HealthReason = "migrations_pending" | "low_disk" | "data_dir_unavailable";

export interface HealthReport {
  status: "ok" | "degraded";
  reasons: HealthReason[];
  version: string;
  uptimeSeconds: number;
  migrations: { applied: number; expected: number };
  disk: { freeBytes: number; totalBytes: number } | null;
  counts: {
    tracks: number;
    importsProcessing: number;
    requestsPending: number;
  };
  ffmpeg: { available: boolean };
  maintenance: {
    lastRunAt: string | null;
    lastResult: MaintenanceStatus["lastResult"];
  };
}

export interface HealthDeps {
  db: DatabaseSync;
  dataDir: string;
  statfs?: StatfsFn;
  minFreeBytes: number;
  version: string;
  startedAt: Date;
  ffmpegAvailable: () => Promise<boolean>;
  maintenance?: { status(): MaintenanceStatus };
  /** Number of migrations the code ships; defaults to `MIGRATIONS.length`. */
  migrationsExpected?: number;
  now?: () => Date;
}

export interface Health {
  evaluate(): Promise<HealthReport>;
}

function count(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { n: number };
  return row.n;
}

export function createHealth(deps: HealthDeps): Health {
  const statfs = deps.statfs ?? (nodeStatfs as unknown as StatfsFn);
  const now = deps.now ?? (() => new Date());
  const expected = deps.migrationsExpected ?? MIGRATIONS.length;

  return {
    async evaluate() {
      const reasons: HealthReason[] = [];

      const applied = count(deps.db, "SELECT COUNT(*) AS n FROM schema_migrations");
      if (applied < expected) reasons.push("migrations_pending");

      let disk: HealthReport["disk"] = null;
      try {
        const stats = await statfs(deps.dataDir);
        disk = {
          freeBytes: stats.bavail * stats.bsize,
          totalBytes: stats.blocks * stats.bsize,
        };
        if (disk.freeBytes < deps.minFreeBytes) reasons.push("low_disk");
      } catch {
        reasons.push("data_dir_unavailable");
      }

      const ffmpeg = await deps.ffmpegAvailable().catch(() => false);
      const maintenance = deps.maintenance?.status();

      return {
        status: reasons.length === 0 ? "ok" : "degraded",
        reasons,
        version: deps.version,
        uptimeSeconds: Math.max(0, Math.floor((now().getTime() - deps.startedAt.getTime()) / 1000)),
        migrations: { applied, expected },
        disk,
        counts: {
          tracks: count(deps.db, "SELECT COUNT(*) AS n FROM tracks"),
          importsProcessing: count(
            deps.db,
            "SELECT COUNT(*) AS n FROM imports WHERE state = 'processing'",
          ),
          requestsPending: count(
            deps.db,
            "SELECT COUNT(*) AS n FROM song_requests WHERE status = 'pending'",
          ),
        },
        ffmpeg: { available: ffmpeg },
        maintenance: {
          lastRunAt: maintenance?.lastRunAt ?? null,
          lastResult: maintenance?.lastResult ?? null,
        },
      };
    },
  };
}
