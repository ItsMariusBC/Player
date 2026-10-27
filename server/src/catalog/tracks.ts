import type { DatabaseSync } from "node:sqlite";
import { NotFoundError, type TrackRecord } from "./types.ts";

interface TrackRow {
  id: string;
  folder_id: string | null;
  title: string;
  artist: string;
  album: string;
  duration_ms: number | null;
  format: "flac" | "mp3" | "wav";
  size_bytes: number;
  sha256: string;
  cover_ext: string | null;
  status: "ready" | "failed";
  position: number;
  created_at: string;
  updated_at: string;
}

function toRecord(row: TrackRow): TrackRecord {
  return {
    id: row.id,
    folderId: row.folder_id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    durationMs: row.duration_ms,
    format: row.format,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    coverExt: row.cover_ext,
    status: row.status,
    position: row.position,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function requireTrack(db: DatabaseSync, id: string): TrackRecord {
  const track = getTrack(db, id);
  if (!track) throw new NotFoundError("Track not found");
  return track;
}

/** Ready tracks only, ordered by folder then position. */
export function listTracks(db: DatabaseSync): TrackRecord[] {
  const rows = db
    .prepare("SELECT * FROM tracks WHERE status = 'ready' ORDER BY folder_id, position, created_at")
    .all() as unknown as TrackRow[];
  return rows.map(toRecord);
}

export function getTrack(db: DatabaseSync, id: string): TrackRecord | null {
  const row = db.prepare("SELECT * FROM tracks WHERE id = ?").get(id) as unknown as
    | TrackRow
    | undefined;
  return row ? toRecord(row) : null;
}

export function findTrackBySha(db: DatabaseSync, sha256: string): TrackRecord | null {
  const row = db.prepare("SELECT * FROM tracks WHERE sha256 = ?").get(sha256) as unknown as
    | TrackRow
    | undefined;
  return row ? toRecord(row) : null;
}

function nextPosition(db: DatabaseSync, folderId: string | null): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM tracks WHERE folder_id IS ?")
    .get(folderId) as unknown as { next: number };
  return row.next;
}

/** Appends a track at the end of its folder. A duplicate sha256 throws the SQLite unique error. */
export function insertTrack(
  db: DatabaseSync,
  input: Omit<TrackRecord, "createdAt" | "updatedAt" | "position">,
  now: Date,
): TrackRecord {
  const position = nextPosition(db, input.folderId);
  const iso = now.toISOString();
  db.prepare(
    `INSERT INTO tracks (id, folder_id, title, artist, album, duration_ms, format, size_bytes, sha256, cover_ext, status, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.folderId,
    input.title,
    input.artist,
    input.album,
    input.durationMs,
    input.format,
    input.sizeBytes,
    input.sha256,
    input.coverExt,
    input.status,
    position,
    iso,
    iso,
  );
  return { ...input, position, createdAt: now, updatedAt: now };
}

const PATCH_COLUMNS = {
  title: "title",
  artist: "artist",
  album: "album",
  coverExt: "cover_ext",
  sha256: "sha256",
  sizeBytes: "size_bytes",
} as const;

export function updateTrack(
  db: DatabaseSync,
  id: string,
  patch: Partial<
    Pick<TrackRecord, "title" | "artist" | "album" | "coverExt" | "sha256" | "sizeBytes">
  >,
  now: Date,
): TrackRecord {
  requireTrack(db, id);
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
    const value = patch[key as keyof typeof PATCH_COLUMNS];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      values.push(value);
    }
  }
  sets.push("updated_at = ?");
  values.push(now.toISOString(), id);
  db.prepare(`UPDATE tracks SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return requireTrack(db, id);
}

function writePositions(db: DatabaseSync, ids: string[]): void {
  const update = db.prepare("UPDATE tracks SET position = ? WHERE id = ?");
  ids.forEach((id, index) => update.run(index, id));
}

function bucketIds(db: DatabaseSync, folderId: string | null): string[] {
  const rows = db
    .prepare("SELECT id FROM tracks WHERE folder_id IS ? ORDER BY position, created_at, rowid")
    .all(folderId) as unknown as { id: string }[];
  return rows.map((row) => row.id);
}

/** Rewrites the positions of a folder bucket (null is the root) as 0..n-1, keeping the order. */
export function renumber(db: DatabaseSync, folderId: string | null): void {
  writePositions(db, bucketIds(db, folderId));
}

/** Moves a track to a folder at a position (end when undefined) and renumbers both buckets. */
export function moveTrack(
  db: DatabaseSync,
  id: string,
  folderId: string | null,
  position: number | undefined,
  now: Date,
): TrackRecord {
  const track = requireTrack(db, id);
  if (folderId !== null) {
    const folder = db.prepare("SELECT id FROM folders WHERE id = ?").get(folderId);
    if (!folder) throw new NotFoundError("Folder not found");
  }
  db.exec("BEGIN");
  try {
    const target = bucketIds(db, folderId).filter((trackId) => trackId !== id);
    const index =
      position === undefined ? target.length : Math.max(0, Math.min(position, target.length));
    target.splice(index, 0, id);
    db.prepare("UPDATE tracks SET folder_id = ?, updated_at = ? WHERE id = ?").run(
      folderId,
      now.toISOString(),
      id,
    );
    writePositions(db, target);
    if (track.folderId !== folderId) renumber(db, track.folderId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return requireTrack(db, id);
}

/** Deletes a track (favorites cascade) and renumbers its folder. */
export function deleteTrack(db: DatabaseSync, id: string): void {
  const track = requireTrack(db, id);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM tracks WHERE id = ?").run(id);
    renumber(db, track.folderId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
