import type { DatabaseSync } from "node:sqlite";
import { inTransaction } from "../catalog/tx.ts";

export type RequestSource = "musicbrainz" | "deezer" | "itunes" | "manual";
export type RequestStatus = "pending" | "accepted";

export const MAX_PENDING_REQUESTS = 20;

export class RequestLimit extends Error {
  constructor() {
    super("Too many pending requests");
    this.name = "RequestLimit";
  }
}

export class RequestDuplicate extends Error {
  constructor() {
    super("Request already pending");
    this.name = "RequestDuplicate";
  }
}

export interface RequestInput {
  userId: string;
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  source: RequestSource;
  coverUrl: string | null;
}

export interface RequestRow {
  id: string;
  user_id: string;
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  source: RequestSource;
  cover_url: string | null;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
  display_name?: string | null;
}

export interface SongRequestDto {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  source: RequestSource;
  coverUrl: string | null;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  requestedBy?: { id: string; displayName: string | null };
}

const COLUMNS =
  "r.id, r.user_id, r.title, r.artist, r.album, r.year, r.source, r.cover_url, r.status, r.created_at, r.updated_at";

/** Same rule as the metadata proposal key: NFKC, French lower case, collapsed spaces, trim. */
const normalize = (text: string | null) =>
  (text ?? "").normalize("NFKC").toLocaleLowerCase("fr").replace(/\s+/g, " ").trim();

export const normalizeKey = (title: string, artist: string): string =>
  JSON.stringify([normalize(title), normalize(artist)]);

export function toRequestDto(row: RequestRow, opts: { withUser?: boolean } = {}): SongRequestDto {
  const dto: SongRequestDto = {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    year: row.year,
    source: row.source,
    coverUrl: row.cover_url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (opts.withUser) {
    dto.requestedBy = { id: row.user_id, displayName: row.display_name ?? null };
  }
  return dto;
}

export function findRequest(db: DatabaseSync, id: string): RequestRow | null {
  const row = db
    .prepare(
      `SELECT ${COLUMNS}, u.display_name FROM song_requests r LEFT JOIN users u ON u.id = r.user_id WHERE r.id = ?`,
    )
    .get(id) as unknown as RequestRow | undefined;
  return row ?? null;
}

export function countPending(db: DatabaseSync, userId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM song_requests WHERE user_id = ? AND status = 'pending'")
    .get(userId) as unknown as { n: number };
  return row.n;
}

export function hasPendingDuplicate(
  db: DatabaseSync,
  userId: string,
  title: string,
  artist: string,
): boolean {
  const key = normalizeKey(title, artist);
  const rows = db
    .prepare("SELECT title, artist FROM song_requests WHERE user_id = ? AND status = 'pending'")
    .all(userId) as unknown as { title: string; artist: string }[];
  return rows.some((row) => normalizeKey(row.title, row.artist) === key);
}

export function createRequest(db: DatabaseSync, input: RequestInput, now: Date): RequestRow {
  return inTransaction(db, () => {
    if (countPending(db, input.userId) >= MAX_PENDING_REQUESTS) throw new RequestLimit();
    if (hasPendingDuplicate(db, input.userId, input.title, input.artist)) {
      throw new RequestDuplicate();
    }
    const id = crypto.randomUUID();
    const stamp = now.toISOString();
    db.prepare(
      "INSERT INTO song_requests (id, user_id, title, artist, album, year, source, cover_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
    ).run(
      id,
      input.userId,
      input.title,
      input.artist,
      input.album,
      input.year,
      input.source,
      input.coverUrl,
      stamp,
      stamp,
    );
    const row = findRequest(db, id);
    if (!row) throw new Error("request vanished after insert");
    return row;
  });
}

/** The user's own requests, most recent first. */
export function listUserRequests(db: DatabaseSync, userId: string, limit = 50): RequestRow[] {
  return db
    .prepare(
      `SELECT ${COLUMNS}, u.display_name FROM song_requests r LEFT JOIN users u ON u.id = r.user_id WHERE r.user_id = ? ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?`,
    )
    .all(userId, limit) as unknown as RequestRow[];
}

/** Pending first, then accepted; most recent first within each. */
export function listAllRequests(db: DatabaseSync, limit = 200): RequestRow[] {
  return db
    .prepare(
      `SELECT ${COLUMNS}, u.display_name FROM song_requests r LEFT JOIN users u ON u.id = r.user_id ORDER BY (r.status = 'pending') DESC, r.created_at DESC, r.rowid DESC LIMIT ?`,
    )
    .all(limit) as unknown as RequestRow[];
}

/** Null when the request does not exist, "not_pending" when it was already accepted. */
export function acceptRequest(
  db: DatabaseSync,
  id: string,
  now: Date,
): RequestRow | "not_pending" | null {
  return inTransaction(db, () => {
    const row = findRequest(db, id);
    if (!row) return null;
    if (row.status !== "pending") return "not_pending";
    db.prepare("UPDATE song_requests SET status = 'accepted', updated_at = ? WHERE id = ?").run(
      now.toISOString(),
      id,
    );
    return findRequest(db, id);
  });
}

/** With opts the request must belong to userId (and be pending when pendingOnly). */
export function deleteRequest(
  db: DatabaseSync,
  id: string,
  opts?: { userId: string; pendingOnly: boolean },
): boolean {
  const clauses = ["id = ?"];
  const params: string[] = [id];
  if (opts) {
    clauses.push("user_id = ?");
    params.push(opts.userId);
    if (opts.pendingOnly) clauses.push("status = 'pending'");
  }
  const result = db
    .prepare(`DELETE FROM song_requests WHERE ${clauses.join(" AND ")}`)
    .run(...params);
  return Number(result.changes) > 0;
}
