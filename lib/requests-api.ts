// lib/requests-api.ts
// Typed client of the song request routes (server/src/routes/requests.ts and the admin ones).
// Every call goes through api() for the CSRF header and the error envelope.
import { api } from "@/lib/api";
import type { MetadataSearchResult } from "@/lib/admin-api";

export type { MetadataSearchResult, Proposal } from "@/lib/admin-api";

export type SongRequestStatus = "pending" | "accepted";

/** Mirrors the server DTO; coverUrl is a provider URL copied server side, never sent by the client. */
export interface SongRequestDto {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  source: "musicbrainz" | "deezer" | "itunes" | "manual";
  coverUrl: string | null;
  status: SongRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSongRequestDto extends SongRequestDto {
  requestedBy: { id: string; displayName: string };
}

export type CreateRequestBody = { proposalId: string } | { title: string; artist?: string };

const id = (value: string) => encodeURIComponent(value);

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Same answer as the admin metadata search, open to every session. */
export function searchSongs(
  q: string,
  opts: { signal?: AbortSignal } = {},
): Promise<MetadataSearchResult> {
  return api<MetadataSearchResult>(`/api/requests/search?q=${encodeURIComponent(q)}`, {
    signal: opts.signal,
  });
}

export async function listMyRequests(): Promise<SongRequestDto[]> {
  const { requests } = await api<{ requests: SongRequestDto[] }>("/api/requests");
  return requests;
}

export async function createRequest(body: CreateRequestBody): Promise<SongRequestDto> {
  const { request } = await api<{ request: SongRequestDto }>("/api/requests", json("POST", body));
  return request;
}

export async function withdrawRequest(requestId: string): Promise<void> {
  await api<void>(`/api/requests/${id(requestId)}`, { method: "DELETE" });
}

export async function listAdminRequests(): Promise<AdminSongRequestDto[]> {
  const { requests } = await api<{ requests: AdminSongRequestDto[] }>("/api/admin/requests");
  return requests;
}

export async function acceptRequest(requestId: string): Promise<AdminSongRequestDto> {
  const { request } = await api<{ request: AdminSongRequestDto }>(
    `/api/admin/requests/${id(requestId)}/accept`,
    { method: "POST" },
  );
  return request;
}

export async function deleteRequest(requestId: string): Promise<void> {
  await api<void>(`/api/admin/requests/${id(requestId)}`, { method: "DELETE" });
}
