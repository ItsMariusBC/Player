import { execFile } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { updateTrackLoudness } from "../catalog/tracks.ts";
import { inTransaction } from "../catalog/tx.ts";
import { ingestFile } from "../media/ingest.ts";
import { measureLoudness, type Loudness } from "../media/loudness.ts";
import type { MediaStorage } from "../media/storage.ts";

export interface ImportQueue {
  enqueue(importId: string): void;
  /** Resolves once every job enqueued so far (and any running backfill pass) has finished. */
  idle(): Promise<void>;
  /**
   * Starts a lazy backfill pass over ready tracks never measured, on the same serialized chain as
   * imports. `queued` is the pending count when a pass starts, 0 when one is already running.
   */
  backfillLoudness(): { queued: number; running: boolean };
  loudnessStatus(): Promise<LoudnessStatus>;
}

export interface LoudnessStatus {
  total: number;
  measured: number;
  /** Attempted without a value (silent or unreadable). */
  failed: number;
  /** Never attempted. */
  pending: number;
  /** A backfill pass is in progress. */
  running: boolean;
  /** Whether ffmpeg can be run. */
  available: boolean;
}

function probeFfmpeg(ffmpegPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(ffmpegPath, ["-version"], { timeout: 10_000, windowsHide: true }, (error) =>
      resolve(!error),
    );
  });
}

interface ImportRow {
  id: string;
  user_id: string;
  filename: string;
}

export function createImportQueue(deps: {
  db: DatabaseSync;
  storage: MediaStorage;
  log?: (event: string, data?: Record<string, unknown>) => void;
  now?: () => Date;
  ffmpegPath?: string;
  /** Test seams: the measurement and the ffmpeg availability check. */
  measure?: (file: string) => Promise<Loudness | null>;
  ffmpegAvailable?: () => Promise<boolean>;
}): ImportQueue {
  const { db, storage, log } = deps;
  const now = deps.now ?? (() => new Date());
  // One worker at a time: a promise chain, so dedupe checks never race each other.
  let chain: Promise<void> = Promise.resolve();
  const ffmpegPath = deps.ffmpegPath ?? "ffmpeg";
  const measure = deps.measure ?? ((file: string) => measureLoudness(file, { ffmpegPath, log }));
  const checkAvailable = deps.ffmpegAvailable ?? (() => probeFfmpeg(ffmpegPath));
  // Only a positive probe is cached: a missing binary is re-checked on each status call.
  let availableCached = false;
  let backfilling = false;
  const inFlight = new Set<string>();
  const PENDING = "status = 'ready' AND loudness_measured_at IS NULL AND loudness_lufs IS NULL";

  function nextPending(): { id: string; format: "flac" | "mp3" | "wav" } | undefined {
    const skip = [...inFlight];
    const exclude = skip.length ? ` AND id NOT IN (${skip.map(() => "?").join(", ")})` : "";
    return db
      .prepare(
        `SELECT id, format FROM tracks WHERE ${PENDING}${exclude} ORDER BY created_at, rowid LIMIT 1`,
      )
      .get(...skip) as { id: string; format: "flac" | "mp3" | "wav" } | undefined;
  }

  /** One backfill step: measure the next pending track, then schedule the next step after the chain. */
  async function backfillStep(): Promise<void> {
    let row: ReturnType<typeof nextPending>;
    try {
      row = nextPending();
    } catch {
      backfilling = false;
      return;
    }
    if (!row) {
      backfilling = false;
      return;
    }
    inFlight.add(row.id);
    try {
      let loudness: Loudness | null = null;
      try {
        loudness = await measure(storage.originalPath(row.id, row.format));
      } catch (error) {
        log?.("loudness.backfill_failed", {
          trackId: row.id,
          error: error instanceof Error ? error.name : "unknown",
        });
      }
      updateTrackLoudness(db, row.id, loudness, now());
    } catch (error) {
      // The database itself is failing: stop the pass rather than spin on the same track.
      log?.("loudness.backfill_failed", {
        trackId: row.id,
        error: error instanceof Error ? error.name : "unknown",
      });
      backfilling = false;
      return;
    } finally {
      inFlight.delete(row.id);
    }
    scheduleBackfillStep();
  }

  function scheduleBackfillStep() {
    chain = chain.then(backfillStep).catch(() => {
      backfilling = false;
    });
  }

  function finish(
    id: string,
    state: "ready" | "failed",
    error: Record<string, unknown> | null,
    trackId: string | null,
  ) {
    db.prepare(
      "UPDATE imports SET state = ?, error = ?, track_id = ?, updated_at = ? WHERE id = ?",
    ).run(state, error ? JSON.stringify(error) : null, trackId, now().toISOString(), id);
  }

  async function run(importId: string): Promise<void> {
    try {
      const row = db
        .prepare("SELECT id, user_id, filename FROM imports WHERE id = ? AND state = 'processing'")
        .get(importId) as unknown as ImportRow | undefined;
      if (!row) {
        await storage.removeIncoming(importId);
        return;
      }
      const stamp = now();
      const result = await ingestFile({
        db,
        storage,
        importId,
        file: path.join(storage.incomingDir(importId), "upload.bin"),
        measure,
        fallbackTitle: path.basename(row.filename, path.extname(row.filename)) || "Untitled",
        now: stamp,
      });
      if (result.kind === "ready") {
        db.exec("BEGIN");
        try {
          finish(importId, "ready", null, result.track.id);
          db.prepare(
            "INSERT INTO admin_events (id, user_id, action, track_id, detail, created_at) VALUES (?, ?, 'import', ?, ?, ?)",
          ).run(
            crypto.randomUUID(),
            row.user_id,
            result.track.id,
            JSON.stringify({ importId, filename: row.filename }),
            stamp.toISOString(),
          );
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      } else if (result.kind === "duplicate") {
        finish(importId, "failed", { reason: "duplicate", trackId: result.trackId }, null);
      } else {
        finish(importId, "failed", { reason: "unsupported_format" }, null);
      }
    } catch (error) {
      log?.("import.failed", {
        importId,
        error: error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
      });
      try {
        finish(importId, "failed", { reason: "internal" }, null);
      } catch {
        // The database itself is failing: nothing more can be recorded.
      }
      await storage.removeIncoming(importId).catch(() => {});
    }
  }

  return {
    enqueue(importId) {
      // run() handles its own errors; the catch keeps the chain alive if even that throws.
      chain = chain.then(() => run(importId)).catch(() => {});
    },
    async idle() {
      // Backfill steps append to the chain as they run: wait until it stops growing.
      let seen: Promise<void>;
      do {
        seen = chain;
        await seen;
      } while (seen !== chain);
    },
    backfillLoudness() {
      if (backfilling) return { queued: 0, running: true };
      const { n } = db
        .prepare(`SELECT COUNT(*) AS n FROM tracks WHERE ${PENDING}`)
        .get() as unknown as {
        n: number;
      };
      if (n === 0) return { queued: 0, running: false };
      backfilling = true;
      scheduleBackfillStep();
      return { queued: n, running: true };
    },
    async loudnessStatus() {
      const counts = db
        .prepare(
          `SELECT COUNT(*) AS total,
                  COUNT(loudness_lufs) AS measured,
                  COALESCE(SUM(loudness_lufs IS NULL AND loudness_measured_at IS NOT NULL), 0) AS failed,
                  COALESCE(SUM(loudness_lufs IS NULL AND loudness_measured_at IS NULL), 0) AS pending
           FROM tracks WHERE status = 'ready'`,
        )
        .get() as unknown as { total: number; measured: number; failed: number; pending: number };
      if (!availableCached) availableCached = await checkAvailable().catch(() => false);
      return {
        total: counts.total,
        measured: counts.measured,
        failed: counts.failed,
        pending: counts.pending,
        running: backfilling,
        available: availableCached,
      };
    },
  };
}

/**
 * Startup recovery: imports left `processing` by a crash or deploy can never finish, so they
 * are failed, and their partial uploads (and any incoming directory without a row) are removed.
 * Returns how many imports were failed.
 */
export async function recoverStaleImports(deps: {
  db: DatabaseSync;
  storage: MediaStorage;
  log?: (event: string, data?: Record<string, unknown>) => void;
  now?: () => Date;
}): Promise<number> {
  const { db, storage, log } = deps;
  const stamp = (deps.now ?? (() => new Date()))().toISOString();
  const stale = (
    db.prepare("SELECT id FROM imports WHERE state = 'processing'").all() as { id: string }[]
  ).map((row) => row.id);
  if (stale.length > 0) {
    inTransaction(db, () => {
      db.prepare(
        "UPDATE imports SET state = 'failed', error = ?, updated_at = ? WHERE state = 'processing'",
      ).run(JSON.stringify({ reason: "internal" }), stamp);
    });
  }
  const known = new Set(
    (db.prepare("SELECT id FROM imports").all() as { id: string }[]).map((row) => row.id),
  );
  const doomed = new Set(stale);
  for (const name of await storage.listIncoming()) if (!known.has(name)) doomed.add(name);
  for (const id of doomed) await storage.removeIncoming(id);
  log?.("imports.recovered", { count: stale.length });
  return stale.length;
}
