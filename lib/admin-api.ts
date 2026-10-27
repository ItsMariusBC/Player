// lib/admin-api.ts
// Typed client of the admin routes (server/src/routes/admin-*.ts). Every call goes through
// api() for the CSRF header and the error envelope, except uploadFile, which needs
// XMLHttpRequest for upload progress and reuses the same error parsing.
import { ApiError, api, toApiError } from "@/lib/api";
import type { FolderNode, TrackDto } from "@/lib/catalog";

export interface AdminFolder {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
}

export interface FolderPatch {
  name?: string;
  parentId?: string | null;
  position?: number;
}

export interface TrackPatch {
  title?: string;
  artist?: string;
  album?: string;
  folderId?: string | null;
  position?: number;
}

/** Fields of a batch edit: at least one; the server validates them as the single PATCH does. */
export interface BatchTrackPatch {
  folderId?: string | null;
  artist?: string;
  album?: string;
}

export interface BatchUpdateResult {
  updated: { id: string; tagsWritten: boolean }[];
  missing: string[];
  /** Tracks whose update failed on the server; the others were applied. */
  failed?: string[];
}

export interface BatchDeleteResult {
  deleted: string[];
  missing: string[];
}

export interface TrackUpdateResult {
  track: TrackDto;
  /** False when the file could not be retagged (WAV, write failure): the database still is. */
  tagsWritten: boolean;
}

/** A metadata proposal; mirrors server/src/metadata/search.ts. */
export interface Proposal {
  /** Opaque, valid 15 minutes on the server; the apply route takes it instead of a URL. */
  id: string;
  source: "musicbrainz" | "deezer" | "itunes";
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  coverUrl: string | null;
}

export interface MetadataSearchResult {
  proposals: Proposal[];
  /** A provider was skipped (rate limit) or did not answer. */
  partial: boolean;
  /** Every provider was skipped by the rate limit: nothing was searched, retry shortly. */
  skipped?: true;
}

export interface MetadataApplyResult extends TrackUpdateResult {
  coverApplied: boolean;
  /** "cover_rejected" when the text was applied but the proposed cover was refused. */
  coverError?: string;
}

export type ImportState = "processing" | "ready" | "failed";

export interface ImportDto {
  id: string;
  filename: string;
  state: ImportState;
  /** Set when state is failed: reason is duplicate, unsupported_format, download_failed or internal. */
  error: { reason: string; trackId?: string; detail?: string } | null;
  trackId: string | null;
  createdAt: string;
  updatedAt: string;
}

const id = (value: string) => encodeURIComponent(value);

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// Folders

export async function listAdminFolders(): Promise<FolderNode[]> {
  const { folders } = await api<{ folders: FolderNode[] }>("/api/admin/folders");
  return folders;
}

export async function createFolder(name: string, parentId: string | null): Promise<AdminFolder> {
  const { folder } = await api<{ folder: AdminFolder }>(
    "/api/admin/folders",
    json("POST", { name, parentId }),
  );
  return folder;
}

export async function updateFolder(folderId: string, patch: FolderPatch): Promise<AdminFolder> {
  const { folder } = await api<{ folder: AdminFolder }>(
    `/api/admin/folders/${id(folderId)}`,
    json("PATCH", patch),
  );
  return folder;
}

/** With force, the folder's content moves up to its parent instead of a 409. */
export async function deleteFolder(folderId: string, opts: { force?: boolean } = {}): Promise<void> {
  const query = opts.force ? "?force=1" : "";
  await api<void>(`/api/admin/folders/${id(folderId)}${query}`, { method: "DELETE" });
}

// Tracks

export function updateTrack(trackId: string, patch: TrackPatch): Promise<TrackUpdateResult> {
  return api<TrackUpdateResult>(`/api/admin/tracks/${id(trackId)}`, json("PATCH", patch));
}

export async function deleteTrack(trackId: string): Promise<void> {
  await api<void>(`/api/admin/tracks/${id(trackId)}`, { method: "DELETE" });
}

export function batchUpdateTracks(ids: string[], patch: BatchTrackPatch): Promise<BatchUpdateResult> {
  return api<BatchUpdateResult>("/api/admin/tracks/batch", json("POST", { ids, patch }));
}

export function batchDeleteTracks(ids: string[]): Promise<BatchDeleteResult> {
  return api<BatchDeleteResult>("/api/admin/tracks/batch-delete", json("POST", { ids }));
}

/** JPEG, PNG or WebP up to 5 MiB; the server checks the signature. */
export function replaceCover(trackId: string, image: File): Promise<{ hasCover: true }> {
  const body = new FormData();
  body.append("file", image);
  return api<{ hasCover: true }>(`/api/admin/tracks/${id(trackId)}/cover`, { method: "POST", body });
}

// Metadata

export function searchMetadata(
  q: string,
  opts: { signal?: AbortSignal } = {},
): Promise<MetadataSearchResult> {
  return api<MetadataSearchResult>(`/api/admin/metadata/search?q=${encodeURIComponent(q)}`, {
    signal: opts.signal,
  });
}

const isApplyResult = (value: unknown): value is MetadataApplyResult =>
  typeof value === "object" &&
  value !== null &&
  "track" in value &&
  typeof (value as { tagsWritten?: unknown }).tagsWritten === "boolean";

/**
 * Applies a proposal's title, artist and album, and its cover when asked. A refused cover
 * answers 422 cover_rejected with the updated track: that is a result, not a failure.
 */
export async function applyMetadata(
  trackId: string,
  proposalId: string,
  applyCover: boolean,
): Promise<MetadataApplyResult> {
  try {
    return await api<MetadataApplyResult>(
      `/api/admin/tracks/${id(trackId)}/metadata`,
      json("POST", { proposalId, applyCover }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.code === "cover_rejected" && isApplyResult(error.details)) {
      const { track, tagsWritten } = error.details;
      return { track, tagsWritten, coverApplied: false, coverError: "cover_rejected" };
    }
    throw error;
  }
}

// Imports

/**
 * Sends one audio file to the import queue (into folderId when given, else the inbox). onProgress receives the uploaded ratio (0 to 1),
 * and 1 once the server answered. Resolves with the importId to poll with getImport.
 */
export function uploadFile(
  file: File,
  onProgress: (ratio: number) => void,
  opts: { signal?: AbortSignal; folderId?: string | null } = {},
): Promise<{ importId: string }> {
  return new Promise((resolve, reject) => {
    const { signal } = opts;
    if (signal?.aborted) {
      reject(new ApiError(0, "aborted", "Envoi annulé"));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbortSignal = () => xhr.abort();
    // Settled requests drop the listener so a long-lived signal keeps no reference to them.
    const settle = () => signal?.removeEventListener("abort", onAbortSignal);
    xhr.open("POST", "/api/admin/imports");
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-Requested-With", "player");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      settle();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(toApiError(xhr.status, xhr.statusText, xhr.responseText));
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as { importId: string };
        onProgress(1);
        resolve(body);
      } catch {
        reject(new ApiError(xhr.status, "bad_response", "Réponse inattendue du serveur"));
      }
    };
    xhr.onerror = () => {
      settle();
      reject(new ApiError(0, "network_error", "Envoi interrompu"));
    };
    xhr.onabort = () => {
      settle();
      reject(new ApiError(0, "aborted", "Envoi annulé"));
    };
    signal?.addEventListener("abort", onAbortSignal, { once: true });
    const body = new FormData();
    // The server reads folderId only when it comes before the file part.
    if (opts.folderId) body.append("folderId", opts.folderId);
    body.append("file", file);
    xhr.send(body);
  });
}

/** Asks the server to download an https URL into the import queue; poll the importId. */
export function importUrl(url: string, folderId: string | null): Promise<{ importId: string }> {
  return api<{ importId: string }>(
    "/api/admin/imports/url",
    json("POST", folderId ? { url, folderId } : { url }),
  );
}

export function getImport(importId: string): Promise<ImportDto> {
  return api<ImportDto>(`/api/admin/imports/${id(importId)}`);
}

/** Most recent first; the server caps limit to 1..200 (50 by default). */
export function listImports(limit?: number): Promise<ImportDto[]> {
  const query = limit === undefined ? "" : `?limit=${limit}`;
  return api<ImportDto[]>(`/api/admin/imports${query}`);
}

/** Upload size accepted by the server (MAX_UPLOAD_MB), to refuse a file before sending it. */
export function getLimits(): Promise<{ maxUploadBytes: number }> {
  return api<{ maxUploadBytes: number }>("/api/admin/limits");
}

/** Loudness measurement progress of the ready tracks (GET /api/admin/loudness). */
export interface LoudnessStatus {
  total: number;
  measured: number;
  /** Attempted without a value (silent or unreadable track). */
  failed: number;
  /** Never attempted. */
  pending: number;
  /** A backfill pass is in progress. */
  running: boolean;
  /** false when the server cannot run ffmpeg. */
  available: boolean;
}

export function getLoudnessStatus(): Promise<LoudnessStatus> {
  return api<LoudnessStatus>("/api/admin/loudness");
}

/** Result of POST /api/admin/loudness/backfill: queued is 0 when a pass was already running. */
export interface BackfillResult {
  queued: number;
  running: boolean;
}

/** Starts a backfill pass over the unmeasured tracks (409 ffmpeg_unavailable without ffmpeg). */
export function backfillLoudness(): Promise<BackfillResult> {
  return api<BackfillResult>("/api/admin/loudness/backfill", { method: "POST" });
}

/** Outcome of one maintenance pass (server/src/admin/maintenance.ts). */
export interface MaintenanceResult {
  orphanMedia: number;
  orphanIncoming: number;
  prunedImports: number;
  durationMs: number;
}

/** GET /api/admin/maintenance. */
export interface MaintenanceStatus {
  lastRunAt: string | null;
  lastResult: MaintenanceResult | null;
  running: boolean;
}

export type HealthReason = "migrations_pending" | "low_disk" | "data_dir_unavailable";

/** GET /api/admin/health (server/src/health.ts). */
export interface HealthReport {
  status: "ok" | "degraded";
  reasons: HealthReason[];
  version: string;
  uptimeSeconds: number;
  migrations: { applied: number; expected: number };
  /** null when the data directory cannot be read. */
  disk: { freeBytes: number; totalBytes: number } | null;
  counts: { tracks: number; importsProcessing: number; requestsPending: number };
  ffmpeg: { available: boolean };
  maintenance: { lastRunAt: string | null; lastResult: MaintenanceResult | null };
}

export function getHealth(): Promise<HealthReport> {
  return api<HealthReport>("/api/admin/health");
}

export function getMaintenance(): Promise<MaintenanceStatus> {
  return api<MaintenanceStatus>("/api/admin/maintenance");
}

/** Runs a maintenance pass now and waits for its result. */
export function runMaintenance(): Promise<MaintenanceResult> {
  return api<MaintenanceResult>("/api/admin/maintenance/run", { method: "POST" });
}
