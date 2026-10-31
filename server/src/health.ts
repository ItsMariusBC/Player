import { statfs as nodeStatfs } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import type { MaintenanceStatus } from "./admin/maintenance.ts";
import { MIGRATIONS } from "./migrations.ts";

export type StatfsFn = (path: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;

export type HealthReason =
  | "migrations_pending"
  | "low_disk"
  | "data_dir_unavailable"
  | "db_unavailable";

/** The lightweight verdict behind the public `/healthz`. */
export interface HealthCheck {
  status: "ok" | "degraded";
  reasons: HealthReason[];
}

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
  /** The disk probe gives up after this long (default 2 s) and reports `data_dir_unavailable`. */
  statfsTimeoutMs?: number;
}

export interface Health {
  /** Migrations and disk only: no counts, no ffmpeg. Never throws. */
  check(): Promise<HealthCheck>;
  /** Full detail for admins. Never throws: a database error degrades the report. */
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
  const timeoutMs = deps.statfsTimeoutMs ?? 2000;

  async function probeDisk(): Promise<NonNullable<HealthReport["disk"]>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("statfs timeout")), timeoutMs);
    });
    try {
      const stats = await Promise.race([statfs(deps.dataDir), timeout]);
      return {
        freeBytes: stats.bavail * stats.bsize,
        totalBytes: stats.blocks * stats.bsize,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Migrations and disk, shared by `check` and `evaluate`. */
  async function core() {
    const reasons: HealthReason[] = [];
    let applied = 0;
    try {
      applied = count(deps.db, "SELECT COUNT(*) AS n FROM schema_migrations");
      if (applied < expected) reasons.push("migrations_pending");
    } catch {
      reasons.push("db_unavailable");
    }
    let disk: HealthReport["disk"] = null;
    try {
      const probed = await probeDisk();
      disk = probed;
      if (probed.freeBytes < deps.minFreeBytes) reasons.push("low_disk");
    } catch {
      reasons.push("data_dir_unavailable");
    }
    return { reasons, applied, disk };
  }

  return {
    async check() {
      const { reasons } = await core();
      return { status: reasons.length === 0 ? "ok" : "degraded", reasons };
    },

    async evaluate() {
      const { reasons, applied, disk } = await core();

      let counts: HealthReport["counts"] = { tracks: 0, importsProcessing: 0, requestsPending: 0 };
      try {
        counts = {
          tracks: count(deps.db, "SELECT COUNT(*) AS n FROM tracks"),
          importsProcessing: count(
            deps.db,
            "SELECT COUNT(*) AS n FROM imports WHERE state = 'processing'",
          ),
          requestsPending: count(
            deps.db,
            "SELECT COUNT(*) AS n FROM song_requests WHERE status = 'pending'",
          ),
        };
      } catch {
        if (!reasons.includes("db_unavailable")) reasons.push("db_unavailable");
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
        counts,
        ffmpeg: { available: ffmpeg },
        maintenance: {
          lastRunAt: maintenance?.lastRunAt ?? null,
          lastResult: maintenance?.lastResult ?? null,
        },
      };
    },
  };
}
