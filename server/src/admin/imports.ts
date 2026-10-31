import { execFile } from "node:child_process";
import { rename, rm, stat } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { recordAdminEvent } from "./events.ts";
import { createTrackLocks, type WithTrackLock } from "./track-edit.ts";
import { convertTrackFormat, updateTrackLoudness, updateTrackVariant } from "../catalog/tracks.ts";
import { inTransaction } from "../catalog/tx.ts";
import { downloadToFile, type DownloadOptions } from "../media/download.ts";
import { ingestFile } from "../media/ingest.ts";
import { measureLoudness, type Loudness } from "../media/loudness.ts";
import { readHead, sniffFormat } from "../media/probe.ts";
import { convertWavToFlac, encodeAac } from "../media/transcode.ts";
import type { MediaStorage } from "../media/storage.ts";
import { MAX_COVER_BYTES } from "../media/image.ts";
import { COVER_HOSTS, guardedFetchImage, resolveHost } from "../metadata/fetch-guard.ts";
import { findRequest, fulfilRequest, type RequestRow } from "../requests/repo.ts";

/** Imports allowed in `processing` at once; further requests are answered 429 `too_many_imports`. */
export const MAX_PROCESSING_IMPORTS = 50;

/** How long a failed ffmpeg probe is trusted before the binary is probed again. */
const NEGATIVE_PROBE_TTL_MS = 5 * 60 * 1000;

/** Downloads running at once; further ones wait for a slot. */
const DOWNLOAD_SLOTS = 2;

export interface ImportQueue {
  enqueue(importId: string): void;
  /**
   * Downloads url into the import's incoming directory outside the serialized chain (at most
   * two at a time), then enqueues it like an upload. A failure marks the import failed.
   */
  enqueueUrl(importId: string, url: string): void;
  /** Resolves once every job enqueued so far (and any running backfill pass) has finished. */
  idle(): Promise<void>;
  /**
   * Starts a lazy backfill pass over ready tracks never measured, on the same serialized chain as
   * imports. `queued` is the pending count when a pass starts, 0 when one is already running.
   */
  backfillLoudness(): { queued: number; running: boolean };
  loudnessStatus(): Promise<LoudnessStatus>;
  /**
   * Manual start of a lazy optimization pass (WAV to FLAC, then the light AAC variant) on the same
   * chain. It first clears `aac_attempted_at` on WAV tracks and on tracks without a variant, so
   * earlier failures are retried. `queued` is the candidate count when a pass starts, 0 when one
   * is already running or there is nothing to do.
   */
  startOptimize(): { queued: number; running: boolean };
  optimizeStatus(): Promise<OptimizeStatus>;
}

export interface OptimizeStatus {
  total: number;
  /** Tracks with a light variant. */
  light: number;
  /** Attempted without a variant. */
  failed: number;
  /** Not attempted yet (`aac_attempted_at` unset). */
  pending: number;
  /** Tracks still stored as WAV. */
  wav: number;
  /** An optimization pass is in progress. */
  running: boolean;
  /** Whether ffmpeg can be run. */
  available: boolean;
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
  folder_id: string | null;
  request_id: string | null;
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
  /** Per-track lock shared with the admin track routes (default: a private instance). */
  trackLocks?: WithTrackLock;
  /** Test seams: WAV to FLAC conversion and AAC encoding (default: ffmpeg through transcode.ts). */
  convertWav?: (src: string, dest: string) => Promise<boolean>;
  encodeAac?: (src: string, dest: string) => Promise<boolean>;
  /** Import by URL: size cap and the network seams (tests inject fetch and resolve). */
  download: Pick<DownloadOptions, "maxBytes"> & Partial<Omit<DownloadOptions, "maxBytes">>;
  /** Cover of a fulfilled request: the guard's network seams (tests inject fetch and resolve). */
  cover?: {
    fetch?: typeof globalThis.fetch;
    resolve?: (host: string) => Promise<string[]>;
    userAgent?: string;
  };
}): ImportQueue {
  const { db, storage, log } = deps;
  const now = deps.now ?? (() => new Date());
  // One worker at a time: a promise chain, so dedupe checks never race each other.
  let chain: Promise<void> = Promise.resolve();
  const ffmpegPath = deps.ffmpegPath ?? "ffmpeg";
  const measure = deps.measure ?? ((file: string) => measureLoudness(file, { ffmpegPath, log }));
  const checkAvailable = deps.ffmpegAvailable ?? (() => probeFfmpeg(ffmpegPath));
  // A positive probe is cached for good; a negative one for 5 minutes, so status calls never
  // spawn a process each time yet a freshly installed binary is noticed.
  const convertWav =
    deps.convertWav ??
    ((src: string, dest: string) => convertWavToFlac(src, dest, { ffmpegPath, log }));
  const encodeLight =
    deps.encodeAac ?? ((src: string, dest: string) => encodeAac(src, dest, { ffmpegPath, log }));
  let availableCached = false;
  let availableCheckedAt: number | null = null;
  let backfilling = false;
  let optimizing = false;
  const withLock = deps.trackLocks ?? createTrackLocks();
  const inFlight = new Set<string>();
  const downloads = new Set<Promise<void>>();
  const waiting: (() => void)[] = [];
  let slots = DOWNLOAD_SLOTS;

  async function acquireSlot(): Promise<void> {
    if (slots > 0) {
      slots -= 1;
      return;
    }
    // The releasing download hands its slot over directly.
    await new Promise<void>((resolve) => waiting.push(resolve));
  }

  function releaseSlot() {
    const next = waiting.shift();
    if (next) next();
    else slots += 1;
  }

  async function downloadJob(importId: string, url: string): Promise<void> {
    await acquireSlot();
    let detail: string | null = null;
    let errorName = "";
    try {
      const dest = path.join(storage.incomingDir(importId), "upload.bin");
      const result = await downloadToFile(url, dest, {
        resolve: resolveHost,
        ...deps.download,
      });
      if (!result.ok) detail = result.detail;
    } catch (error) {
      detail = "unreachable";
      errorName = error instanceof Error ? error.name : "unknown";
    } finally {
      releaseSlot();
    }
    if (detail === null) {
      enqueue(importId);
      return;
    }
    let host = "";
    try {
      host = new URL(url).host;
    } catch {
      // The route validated the URL; nothing to log then.
    }
    log?.("import.download_failed", { importId, detail, error: errorName, host });
    try {
      finish(importId, "failed", { reason: "download_failed", detail }, null);
    } catch {
      // The database itself is failing: nothing more can be recorded.
    }
    await storage.removeIncoming(importId).catch(() => {});
  }
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

  // Only never-attempted tracks: a failure stamps `aac_attempted_at`, so it is not replayed
  // automatically; the manual start clears the stamp to retry.
  const OPTIMIZE_PENDING = "status = 'ready' AND aac_attempted_at IS NULL";

  function nextOptimizeCandidate(): { id: string } | undefined {
    const skip = [...inFlight];
    const exclude = skip.length ? ` AND id NOT IN (${skip.map(() => "?").join(", ")})` : "";
    return db
      .prepare(
        `SELECT id FROM tracks WHERE ${OPTIMIZE_PENDING}${exclude} ORDER BY created_at, rowid LIMIT 1`,
      )
      .get(...skip) as { id: string } | undefined;
  }

  function readOptimizeRow(id: string) {
    return db
      .prepare(
        "SELECT format, size_bytes, aac_attempted_at FROM tracks WHERE id = ? AND status = 'ready'",
      )
      .get(id) as
      | {
          format: "flac" | "mp3" | "wav";
          size_bytes: number;
          aac_attempted_at: string | null;
        }
      | undefined;
  }

  /** Converts a WAV original to FLAC; false (nothing changed) on any failure. */
  async function convertOriginal(id: string): Promise<boolean> {
    const scratch = storage.scratchPath(id);
    try {
      if (!(await convertWav(storage.originalPath(id, "wav"), scratch))) {
        await rm(scratch, { force: true });
        return false;
      }
      if (sniffFormat(await readHead(scratch)) !== "flac") {
        await rm(scratch, { force: true });
        return false;
      }
      const { size } = await stat(scratch);
      // New file first, then the row, then the old file: a reader on the old inode is never cut.
      await rename(scratch, storage.originalPath(id, "flac"));
      if (!convertTrackFormat(db, id, "flac", size)) {
        await rm(storage.originalPath(id, "flac"), { force: true });
        return false;
      }
      await rm(storage.originalPath(id, "wav"), { force: true });
      return true;
    } catch (error) {
      log?.("media.optimize_failed", {
        trackId: id,
        step: "flac",
        error: error instanceof Error ? error.name : "unknown",
      });
      await rm(scratch, { force: true }).catch(() => {});
      return false;
    }
  }

  /** An `original.wav` left next to a FLAC row (a crash after the row switched): removed. */
  async function removeStaleWav(id: string): Promise<void> {
    const wav = storage.originalPath(id, "wav");
    try {
      await stat(wav);
    } catch {
      return;
    }
    await rm(wav, { force: true }).catch(() => {});
    log?.("optimize.stale_wav_removed", { trackId: id });
  }

  /** The variant size, or null on failure or when it is not smaller than the original. */
  async function encodeVariant(
    id: string,
    format: "flac" | "mp3" | "wav",
    originalSize: number,
  ): Promise<number | null> {
    const scratch = storage.scratchPath(id);
    try {
      if (!(await encodeLight(storage.originalPath(id, format), scratch))) {
        await rm(scratch, { force: true });
        return null;
      }
      const { size } = await stat(scratch);
      if (size >= originalSize) {
        await rm(scratch, { force: true });
        await rm(storage.variantPath(id), { force: true });
        log?.("optimize.variant_not_smaller", { trackId: id, variantBytes: size, originalSize });
        return null;
      }
      await rename(scratch, storage.variantPath(id));
      return size;
    } catch (error) {
      log?.("media.optimize_failed", {
        trackId: id,
        step: "aac",
        error: error instanceof Error ? error.name : "unknown",
      });
      await rm(scratch, { force: true }).catch(() => {});
      return null;
    }
  }

  /** One optimization step: the next candidate, then schedule the following step after the chain. */
  async function optimizeStep(): Promise<void> {
    let candidate: ReturnType<typeof nextOptimizeCandidate>;
    try {
      candidate = nextOptimizeCandidate();
    } catch {
      optimizing = false;
      return;
    }
    if (!candidate) {
      optimizing = false;
      return;
    }
    const id = candidate.id;
    inFlight.add(id);
    try {
      // Under the track lock, and rechecked at each stage: the track may have been deleted or changed.
      await withLock(id, async () => {
        let row = readOptimizeRow(id);
        if (row?.format === "flac") await removeStaleWav(id);
        if (row?.format === "wav") await convertOriginal(id);
        row = readOptimizeRow(id);
        if (row && row.aac_attempted_at === null) {
          const size = await encodeVariant(id, row.format, row.size_bytes);
          if (!updateTrackVariant(db, id, size, now())) {
            await rm(storage.variantPath(id), { force: true }).catch(() => {});
          }
        }
      });
    } catch (error) {
      // The database itself is failing: stop the pass rather than spin on the same track.
      log?.("media.optimize_failed", {
        trackId: id,
        step: "db",
        error: error instanceof Error ? error.name : "unknown",
      });
      optimizing = false;
      return;
    } finally {
      inFlight.delete(id);
    }
    scheduleOptimizeStep();
  }

  function scheduleOptimizeStep() {
    chain = chain.then(optimizeStep).catch(() => {
      optimizing = false;
    });
  }

  function countOptimizable(): number {
    return (
      db.prepare(`SELECT COUNT(*) AS n FROM tracks WHERE ${OPTIMIZE_PENDING}`).get() as unknown as {
        n: number;
      }
    ).n;
  }

  function startOptimizePass(retryFailed = false): number {
    if (optimizing) return 0;
    if (retryFailed) {
      db.prepare(
        "UPDATE tracks SET aac_attempted_at = NULL WHERE status = 'ready' AND (format = 'wav' OR aac_size_bytes IS NULL)",
      ).run();
    }
    const n = countOptimizable();
    if (n === 0) return 0;
    optimizing = true;
    scheduleOptimizeStep();
    return n;
  }

  async function ensureAvailable(): Promise<boolean> {
    if (
      !availableCached &&
      (availableCheckedAt === null || now().getTime() - availableCheckedAt >= NEGATIVE_PROBE_TTL_MS)
    ) {
      availableCached = await checkAvailable().catch(() => false);
      availableCheckedAt = now().getTime();
    }
    return availableCached;
  }

  /** After an import: start a pass when none runs and ffmpeg is there; silent (no admin event). */
  function autoOptimize() {
    if (optimizing) return;
    const job = (async () => {
      if (!(await ensureAvailable()) || optimizing) return;
      startOptimizePass();
    })()
      .catch(() => {})
      .finally(() => downloads.delete(job));
    downloads.add(job);
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

  function findOpenRequest(id: string): RequestRow | null {
    const found = findRequest(db, id);
    return found && (found.status === "pending" || found.status === "accepted") ? found : null;
  }

  /** The requested cover, only when the file has no embedded one; a failure is logged and ignored. */
  async function requestCover(importId: string, request: RequestRow, embedded: boolean) {
    if (embedded || !request.cover_url) return null;
    try {
      return await guardedFetchImage(new URL(request.cover_url), {
        allowedHosts: COVER_HOSTS,
        maxBytes: MAX_COVER_BYTES,
        resolve: deps.cover?.resolve ?? resolveHost,
        fetch: deps.cover?.fetch,
        userAgent: deps.cover?.userAgent,
      });
    } catch (error) {
      log?.("request.cover_failed", {
        importId,
        requestId: request.id,
        error: error instanceof Error ? error.name : "unknown",
        reason: (error as { reason?: unknown }).reason,
      });
      return null;
    }
  }

  /** Marks the request added and records the event; inside the caller's transaction. */
  function fulfil(requestId: string, trackId: string, userId: string, stamp: Date) {
    if (!fulfilRequest(db, requestId, trackId, stamp)) return;
    recordAdminEvent(
      db,
      { userId, action: "request_fulfilled", trackId, detail: { requestId, trackId } },
      stamp,
    );
  }

  async function run(importId: string): Promise<void> {
    try {
      const row = db
        .prepare(
          "SELECT id, user_id, filename, folder_id, request_id FROM imports WHERE id = ? AND state = 'processing'",
        )
        .get(importId) as unknown as ImportRow | undefined;
      if (!row) {
        await storage.removeIncoming(importId);
        return;
      }
      const stamp = now();
      const request = row.request_id ? findOpenRequest(row.request_id) : null;
      const result = await ingestFile({
        db,
        storage,
        importId,
        file: path.join(storage.incomingDir(importId), "upload.bin"),
        measure,
        convertWav,
        // The folder may have been deleted since the import was accepted: then the inbox.
        folderId: () => {
          if (!row.folder_id) return null;
          const folder = db.prepare("SELECT id FROM folders WHERE id = ?").get(row.folder_id) as
            | { id: string }
            | undefined;
          return folder ? folder.id : null;
        },
        ...(request
          ? {
              ...(request.title.trim() ? { title: request.title } : {}),
              ...(request.artist.trim() ? { artist: request.artist } : {}),
              ...(request.album?.trim() ? { album: request.album } : {}),
              cover: (embedded: boolean) => requestCover(importId, request, embedded),
            }
          : {}),
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
          if (row.request_id) fulfil(row.request_id, result.track.id, row.user_id, stamp);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        autoOptimize();
      } else if (result.kind === "duplicate") {
        inTransaction(db, () => {
          finish(importId, "failed", { reason: "duplicate", trackId: result.trackId }, null);
          if (row.request_id) fulfil(row.request_id, result.trackId, row.user_id, stamp);
        });
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

  function enqueue(importId: string) {
    // run() handles its own errors; the catch keeps the chain alive if even that throws.
    chain = chain.then(() => run(importId)).catch(() => {});
  }

  return {
    enqueue,
    enqueueUrl(importId, url) {
      const job = downloadJob(importId, url)
        .catch(() => {})
        .finally(() => downloads.delete(job));
      downloads.add(job);
    },
    async idle() {
      // Backfill steps and finished downloads append to the chain: wait until nothing grows.
      for (;;) {
        if (downloads.size > 0) {
          await Promise.all([...downloads]);
          continue;
        }
        const seen = chain;
        await seen;
        if (seen === chain && downloads.size === 0) return;
      }
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
      const available = await ensureAvailable();
      return {
        total: counts.total,
        measured: counts.measured,
        failed: counts.failed,
        pending: counts.pending,
        running: backfilling,
        available,
      };
    },
    startOptimize() {
      const queued = startOptimizePass(true);
      return { queued, running: optimizing };
    },
    async optimizeStatus() {
      const counts = db
        .prepare(
          `SELECT COUNT(*) AS total,
                  COALESCE(SUM(aac_size_bytes IS NOT NULL), 0) AS light,
                  COALESCE(SUM(aac_size_bytes IS NULL AND aac_attempted_at IS NOT NULL), 0) AS failed,
                  COALESCE(SUM(aac_attempted_at IS NULL), 0) AS pending,
                  COALESCE(SUM(format = 'wav'), 0) AS wav
           FROM tracks WHERE status = 'ready'`,
        )
        .get() as unknown as Omit<OptimizeStatus, "running" | "available">;
      return { ...counts, running: optimizing, available: await ensureAvailable() };
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
