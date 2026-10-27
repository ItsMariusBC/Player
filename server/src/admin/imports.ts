import type { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { ingestFile } from "../media/ingest.ts";
import type { MediaStorage } from "../media/storage.ts";

export interface ImportQueue {
  enqueue(importId: string): void;
  /** Resolves once every job enqueued so far has finished. */
  idle(): Promise<void>;
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
}): ImportQueue {
  const { db, storage, log } = deps;
  const now = deps.now ?? (() => new Date());
  // One worker at a time: a promise chain, so dedupe checks never race each other.
  let chain: Promise<void> = Promise.resolve();

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
      chain = chain.then(() => run(importId));
    },
    idle() {
      return chain;
    },
  };
}
