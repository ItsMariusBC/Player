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

export interface TrackUpdateResult {
  track: TrackDto;
  /** False when the file could not be retagged (WAV, write failure): the database still is. */
  tagsWritten: boolean;
}

export type ImportState = "processing" | "ready" | "failed";

export interface ImportDto {
  id: string;
  filename: string;
  state: ImportState;
  error: { code: string; trackId?: string } | null;
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

/** JPEG, PNG or WebP up to 5 MiB; the server checks the signature. */
export function replaceCover(trackId: string, image: File): Promise<{ hasCover: true }> {
  const body = new FormData();
  body.append("file", image);
  return api<{ hasCover: true }>(`/api/admin/tracks/${id(trackId)}/cover`, { method: "POST", body });
}

// Imports

/**
 * Sends one audio file to the import queue. onProgress receives the uploaded ratio (0 to 1),
 * and 1 once the server answered. Resolves with the importId to poll with getImport.
 */
export function uploadFile(
  file: File,
  onProgress: (ratio: number) => void,
  opts: { signal?: AbortSignal } = {},
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
    body.append("file", file);
    xhr.send(body);
  });
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
