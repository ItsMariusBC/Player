// lib/import-queue.ts
// State of the panel's client-side import queue, one entry per dropped file. No React here,
// so the Bun unit tests import it directly; lib/hooks/use-import-queue.ts drives it.
import type { ImportDto } from "@/lib/admin-api";

/** Uploads sent at the same time; the others wait in order. */
export const MAX_PARALLEL_UPLOADS = 2;

export type FailureCode = "duplicate" | "unsupported_format" | "too_large"
  | "download_failed"
  | "internal";

export type EntryStatus =
  | { kind: "pending" }
  | { kind: "uploading"; progress: number }
  | { kind: "processing"; importId: string }
  | { kind: "ready"; trackId: string }
  | { kind: "failed"; code: FailureCode; trackId?: string; detail?: string };

export interface QueueEntry {
  key: string;
  /** A URL entry has no upload progress: it is sent as a request and goes straight to analysis. */
  kind: "file" | "url";
  filename: string;
  size: number;
  status: EntryStatus;
}

export interface QueueState {
  entries: QueueEntry[];
}

export type QueueAction =
  | {
      type: "add";
      files: { key: string; kind?: "file" | "url"; filename: string; size: number }[];
      /** null when the limit is unknown: no check before sending. */
      maxUploadBytes: number | null;
    }
  | { type: "start"; key: string }
  | { type: "progress"; key: string; ratio: number }
  | { type: "uploaded"; key: string; importId: string }
  | { type: "ready"; key: string; trackId: string }
  | { type: "failed"; key: string; code: FailureCode; trackId?: string; detail?: string }
  | { type: "clear" };

export const initialQueueState: QueueState = { entries: [] };

const KNOWN_CODES = new Set<string>([
  "duplicate",
  "unsupported_format",
  "too_large",
  "download_failed",
]);

/** Server or client error code to the queue's failure code; anything else is « internal ». */
export function toFailureCode(code: string | undefined): FailureCode {
  return code && KNOWN_CODES.has(code) ? (code as FailureCode) : "internal";
}

const update = (
  state: QueueState,
  key: string,
  next: (entry: QueueEntry) => EntryStatus | null,
): QueueState => {
  let changed = false;
  const entries = state.entries.map((entry) => {
    if (entry.key !== key) return entry;
    const status = next(entry);
    if (!status) return entry;
    changed = true;
    return { ...entry, status };
  });
  return changed ? { entries } : state;
};

export function importQueueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "add": {
      const limit = action.maxUploadBytes;
      const added = action.files.map<QueueEntry>((file) => ({
        ...file,
        kind: file.kind ?? "file",
        status:
          file.kind !== "url" && limit !== null && file.size > limit
            ? { kind: "failed", code: "too_large" }
            : { kind: "pending" },
      }));
      return { entries: [...state.entries, ...added] };
    }
    case "start":
      return update(state, action.key, (entry) =>
        entry.status.kind === "pending" ? { kind: "uploading", progress: 0 } : null,
      );
    case "progress":
      return update(state, action.key, (entry) =>
        entry.kind === "file" && entry.status.kind === "uploading"
          ? { kind: "uploading", progress: Math.min(Math.max(action.ratio, 0), 1) }
          : null,
      );
    case "uploaded":
      return update(state, action.key, (entry) =>
        entry.status.kind === "uploading" ? { kind: "processing", importId: action.importId } : null,
      );
    case "ready":
      return update(state, action.key, () => ({ kind: "ready", trackId: action.trackId }));
    case "failed":
      return update(state, action.key, () => ({
        kind: "failed",
        code: action.code,
        ...(action.trackId === undefined ? {} : { trackId: action.trackId }),
        ...(action.detail === undefined ? {} : { detail: action.detail }),
      }));
    case "clear":
      return {
        entries: state.entries.filter(
          (entry) => entry.status.kind !== "ready" && entry.status.kind !== "failed",
        ),
      };
  }
}

/**
 * Final status of a polled import, or null while the server still analyses it. Reads the
 * server's error.reason; a ready import without its track counts as a server error.
 */
export function failureFromImport(
  dto: ImportDto,
): Extract<EntryStatus, { kind: "ready" | "failed" }> | null {
  if (dto.state === "processing") return null;
  if (dto.state === "ready") {
    return dto.trackId ? { kind: "ready", trackId: dto.trackId } : { kind: "failed", code: "internal" };
  }
  const code = toFailureCode(dto.error?.reason);
  const trackId = dto.error?.trackId;
  const detail = code === "download_failed" ? dto.error?.detail : undefined;
  return {
    kind: "failed",
    code,
    ...(trackId === undefined ? {} : { trackId }),
    ...(detail === undefined ? {} : { detail }),
  };
}

/** The pending entries to start now so that at most MAX_PARALLEL_UPLOADS are uploading. */
export function nextTransfers(state: QueueState, max = MAX_PARALLEL_UPLOADS): QueueEntry[] {
  const running = state.entries.filter((entry) => entry.status.kind === "uploading").length;
  const free = Math.max(max - running, 0);
  return state.entries.filter((entry) => entry.status.kind === "pending").slice(0, free);
}

/** Nothing left to send or analyse. */
export function isQueueIdle(state: QueueState): boolean {
  return state.entries.every(
    (entry) => entry.status.kind === "ready" || entry.status.kind === "failed",
  );
}

export interface LabelContext {
  maxUploadBytes: number | null;
  /** Title of a catalogue track, undefined when it is not there. */
  titleOf: (trackId: string) => string | undefined;
}

export function entryLabel(entry: QueueEntry, ctx: LabelContext): string {
  const { status } = entry;
  switch (status.kind) {
    case "pending":
      return entry.kind === "url" ? "Téléchargement…" : "Envoi 0 %";
    case "uploading":
      if (entry.kind === "url") return "Téléchargement…";
      return `Envoi ${Math.round(status.progress * 100)} %`;
    case "processing":
      return "Analyse…";
    case "ready":
      return "Importé";
    case "failed":
      switch (status.code) {
        case "duplicate": {
          const title = status.trackId === undefined ? undefined : ctx.titleOf(status.trackId);
          return title ? `Doublon de ${title}` : "Doublon";
        }
        case "unsupported_format":
          return "Format non reconnu";
        case "too_large":
          return ctx.maxUploadBytes === null
            ? "Trop volumineux"
            : `Trop volumineux (max ${Math.round(ctx.maxUploadBytes / 1024 / 1024)} Mo)`;
        case "download_failed":
          return status.detail
            ? `Téléchargement impossible (${status.detail})`
            : "Téléchargement impossible";
        case "internal":
          return "Erreur serveur";
      }
  }
}
