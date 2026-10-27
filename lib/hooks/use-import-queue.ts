// lib/hooks/use-import-queue.ts
// Drives lib/import-queue: sends at most two files at a time (XHR, for the progress bar),
// then polls GET /api/admin/imports/:id every second until the server says ready or failed.
// Unmounting the panel aborts the uploads in flight and stops every poll.
import { useCallback, useEffect, useReducer, useRef } from "react";
import { getImport, uploadFile } from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import {
  type QueueEntry,
  failureFromImport,
  importQueueReducer,
  initialQueueState,
  isQueueIdle,
  nextTransfers,
  toFailureCode,
} from "@/lib/import-queue";

const POLL_MS = 1000;
/** Consecutive poll failures before the row gives up with « Erreur serveur ». */
const MAX_POLL_MISSES = 3;

/** Resolves after ms, or as soon as the signal aborts. */
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });

export interface ImportQueue {
  entries: QueueEntry[];
  /** Nothing left to send or analyse. */
  idle: boolean;
  addFiles(files: File[]): void;
  /** Drops the finished rows. */
  clear(): void;
}

export function useImportQueue(opts: {
  /** null while unknown: files go to the server unchecked. */
  maxUploadBytes: number | null;
  /** Called after each import that reached ready. */
  onReady: () => void;
}): ImportQueue {
  const { maxUploadBytes } = opts;
  const [state, dispatch] = useReducer(importQueueReducer, initialQueueState);
  const files = useRef(new Map<string, File>());
  const started = useRef(new Set<string>());
  const nextKey = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const onReadyRef = useRef(opts.onReady);
  useEffect(() => {
    onReadyRef.current = opts.onReady;
  }, [opts.onReady]);

  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);

  const poll = useCallback(async (key: string, importId: string, signal: AbortSignal) => {
    let misses = 0;
    for (;;) {
      await wait(POLL_MS, signal);
      if (signal.aborted) return;
      try {
        const dto = await getImport(importId);
        if (signal.aborted) return;
        misses = 0;
        const status = failureFromImport(dto);
        if (status?.kind === "ready") {
          dispatch({ type: "ready", key, trackId: status.trackId });
          onReadyRef.current();
          return;
        }
        if (status) {
          dispatch({ type: "failed", key, code: status.code, trackId: status.trackId });
          return;
        }
      } catch (error) {
        if (signal.aborted) return;
        misses += 1;
        if (misses >= MAX_POLL_MISSES) {
          console.error("Import status unavailable", error);
          dispatch({ type: "failed", key, code: "internal" });
          return;
        }
      }
    }
  }, []);

  const transfer = useCallback(
    async (key: string, signal: AbortSignal) => {
      const file = files.current.get(key);
      if (!file) {
        dispatch({ type: "failed", key, code: "internal" });
        return;
      }
      try {
        const { importId } = await uploadFile(
          file,
          (ratio) => {
            if (!signal.aborted) dispatch({ type: "progress", key, ratio });
          },
          { signal },
        );
        if (signal.aborted) return;
        dispatch({ type: "uploaded", key, importId });
        await poll(key, importId, signal);
      } catch (error) {
        if (signal.aborted) return;
        const code = error instanceof ApiError ? error.code : undefined;
        if (code !== "too_large") console.error("Upload failed", error);
        dispatch({ type: "failed", key, code: toFailureCode(code) });
      } finally {
        files.current.delete(key);
      }
    },
    [poll],
  );

  useEffect(() => {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted) return;
    for (const entry of nextTransfers(state)) {
      if (started.current.has(entry.key)) continue;
      started.current.add(entry.key);
      dispatch({ type: "start", key: entry.key });
      void transfer(entry.key, signal);
    }
  }, [state, transfer]);

  const addFiles = useCallback(
    (list: File[]) => {
      if (list.length === 0) return;
      const added = list.map((file) => {
        nextKey.current += 1;
        const key = `import-${nextKey.current}`;
        if (maxUploadBytes === null || file.size <= maxUploadBytes) files.current.set(key, file);
        return { key, filename: file.name, size: file.size };
      });
      dispatch({ type: "add", files: added, maxUploadBytes });
    },
    [maxUploadBytes],
  );

  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  return { entries: state.entries, idle: isQueueIdle(state), addFiles, clear };
}
