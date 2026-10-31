// lib/hooks/use-import-queue.ts
// Drives lib/import-queue: sends at most two files at a time (XHR, for the progress bar),
// then polls GET /api/admin/imports/:id every second until the server says ready or failed.
// Unmounting the panel aborts the uploads in flight and stops every poll.
import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  createFolder,
  getImport,
  importUrl,
  listAdminFolders,
  uploadFile,
} from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import type { FolderNode } from "@/lib/catalog";
import { pathKey, planFolders } from "@/lib/folder-plan";
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

/** What a queue entry sends: a file with its target folder, or a URL for the server to fetch. */
type Job =
  | { kind: "file"; file: File; folderId: string | null; requestId: string | null }
  | { kind: "url"; url: string; folderId: string | null };

const findChild = (tree: FolderNode[], parentId: string | null, name: string) => {
  let siblings: FolderNode[] | undefined = tree;
  if (parentId !== null) {
    siblings = undefined;
    const stack = [...tree];
    for (let node = stack.pop(); node; node = stack.pop()) {
      if (node.id === parentId) {
        siblings = node.children;
        break;
      }
      stack.push(...node.children);
    }
  }
  return siblings?.find((node) => node.name === name);
};

export interface ImportQueue {
  entries: QueueEntry[];
  /** Nothing left to send or analyse. */
  idle: boolean;
  /** Files of the picker or a plain drop, all into folderId (null: the inbox). */
  addFiles(
    files: File[],
    opts?: { folderId?: string | null; requestId?: string | null; requestTitle?: string },
  ): void;
  /**
   * Files of a dropped or chosen folder: the folders missing under rootId are created first,
   * then each file is sent into its own folder.
   */
  addEntries(items: { file: File; path: string[] }[], rootId: string | null): Promise<void>;
  /** The server downloads the https URL; the row has no upload progress. */
  addUrl(url: string, folderId: string | null): void;
  /** Drops the finished rows. */
  clear(): void;
}

export function useImportQueue(opts: {
  /** null while unknown: files go to the server unchecked. */
  maxUploadBytes: number | null;
  /** Called after each import that reached ready. */
  onReady: () => void;
  /** The current admin folder tree, to plan the folders of a dropped directory. */
  getFolders: () => FolderNode[];
  /** Folder creation failures (the panel's banner). */
  onError: (error: unknown) => void;
}): ImportQueue {
  const { maxUploadBytes } = opts;
  const [state, dispatch] = useReducer(importQueueReducer, initialQueueState);
  const jobs = useRef(new Map<string, Job>());
  const started = useRef(new Set<string>());
  const nextKey = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const onReadyRef = useRef(opts.onReady);
  const getFoldersRef = useRef(opts.getFolders);
  const onErrorRef = useRef(opts.onError);
  useEffect(() => {
    onReadyRef.current = opts.onReady;
    getFoldersRef.current = opts.getFolders;
    onErrorRef.current = opts.onError;
  }, [opts.onReady, opts.getFolders, opts.onError]);

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
          dispatch({
            type: "failed",
            key,
            code: status.code,
            trackId: status.trackId,
            detail: status.detail,
          });
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
      const job = jobs.current.get(key);
      if (!job) {
        dispatch({ type: "failed", key, code: "internal" });
        return;
      }
      try {
        const { importId } =
          job.kind === "url"
            ? await importUrl(job.url, job.folderId)
            : await uploadFile(
                job.file,
                (ratio) => {
                  if (!signal.aborted) dispatch({ type: "progress", key, ratio });
                },
                { signal, folderId: job.folderId, requestId: job.kind === "file" ? job.requestId : null },
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
        jobs.current.delete(key);
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

  const enqueue = useCallback(
    (
      list: {
        file: File;
        folderId: string | null;
        requestId?: string | null;
        requestTitle?: string;
      }[],
    ) => {
      if (list.length === 0) return;
      const added = list.map(({ file, folderId, requestId = null, requestTitle }) => {
        nextKey.current += 1;
        const key = `import-${nextKey.current}`;
        if (maxUploadBytes === null || file.size <= maxUploadBytes) {
          jobs.current.set(key, { kind: "file", file, folderId, requestId });
        }
        return { key, filename: file.name, size: file.size, requestTitle };
      });
      dispatch({ type: "add", files: added, maxUploadBytes });
    },
    [maxUploadBytes],
  );

  const addFiles = useCallback(
    (
      list: File[],
      addOpts: { folderId?: string | null; requestId?: string | null; requestTitle?: string } = {},
    ) => {
      const folderId = addOpts.folderId ?? null;
      const { requestId, requestTitle } = addOpts;
      enqueue(list.map((file) => ({ file, folderId, requestId, requestTitle })));
    },
    [enqueue],
  );

  const addEntries = useCallback(
    async (items: { file: File; path: string[] }[], rootId: string | null) => {
      if (items.length === 0) return;
      const plan = planFolders(
        getFoldersRef.current(),
        rootId,
        items.map((item) => item.path),
      );
      // Create key to the id the server gave (or an existing folder found after a conflict).
      const created = new Map<string, string>();
      const idOf = (key: string | null): string | null =>
        key === null ? null : (created.get(key) ?? key);
      try {
        for (const step of plan.creates) {
          const parentId = idOf(step.parentKey);
          try {
            created.set(step.key, (await createFolder(step.name, parentId)).id);
          } catch (error) {
            if (!(error instanceof ApiError) || error.code !== "folder_conflict") throw error;
            const existing = findChild(await listAdminFolders(), parentId, step.name);
            if (!existing) throw error;
            created.set(step.key, existing.id);
          }
        }
      } catch (error) {
        onErrorRef.current(error);
        return;
      }
      enqueue(
        items.map(({ file, path }) => ({
          file,
          folderId: idOf(plan.resolve.get(pathKey(path)) ?? null),
        })),
      );
    },
    [enqueue],
  );

  const addUrl = useCallback(
    (url: string, folderId: string | null) => {
      nextKey.current += 1;
      const key = `import-${nextKey.current}`;
      jobs.current.set(key, { kind: "url", url, folderId });
      let filename = url;
      try {
        const { pathname, hostname } = new URL(url);
        filename = pathname.split("/").filter(Boolean).pop() ?? hostname;
      } catch {
        // The server validates the URL; the raw text is the row's name.
      }
      dispatch({ type: "add", files: [{ key, kind: "url", filename, size: 0 }], maxUploadBytes });
    },
    [maxUploadBytes],
  );

  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  return { entries: state.entries, idle: isQueueIdle(state), addFiles, addEntries, addUrl, clear };
}
