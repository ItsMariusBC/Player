import type { DatabaseSync } from "node:sqlite";
import { hashSessionId, newSessionId, open, seal } from "../crypto.ts";

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  groupsCheckedAt: Date;
  refreshToken: string | null;
  idToken: string | null;
}

interface SessionRow {
  user_id: string;
  created_at: string;
  expires_at: string;
  groups_checked_at: string;
  refresh_token_sealed: string | null;
  id_token_sealed: string | null;
}

function sealOrNull(token: string | undefined, key: Buffer): string | null {
  return token === undefined ? null : seal(token, key);
}

function openOrNull(sealed: string | null, key: Buffer): string | null {
  return sealed === null ? null : open(sealed, key);
}

/** Stores a new session (only the hash of its id) and returns it with the plaintext id. */
export function createSession(
  db: DatabaseSync,
  key: Buffer,
  input: { userId: string; refreshToken?: string; idToken?: string; ttlMs: number },
  now: Date,
): SessionRecord {
  const id = newSessionId();
  const expiresAt = new Date(now.getTime() + input.ttlMs);
  db.prepare(
    `INSERT INTO sessions (id_hash, user_id, created_at, expires_at, refresh_token_sealed, id_token_sealed, groups_checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    hashSessionId(id),
    input.userId,
    now.toISOString(),
    expiresAt.toISOString(),
    sealOrNull(input.refreshToken, key),
    sealOrNull(input.idToken, key),
    now.toISOString(),
  );
  return {
    id,
    userId: input.userId,
    createdAt: now,
    expiresAt,
    groupsCheckedAt: now,
    refreshToken: input.refreshToken ?? null,
    idToken: input.idToken ?? null,
  };
}

/** Returns the live session for a plaintext id, deleting it when expired. */
export function findSession(
  db: DatabaseSync,
  key: Buffer,
  id: string,
  now: Date,
): SessionRecord | null {
  const idHash = hashSessionId(id);
  const row = db
    .prepare(
      `SELECT user_id, created_at, expires_at, groups_checked_at, refresh_token_sealed, id_token_sealed
       FROM sessions WHERE id_hash = ?`,
    )
    .get(idHash) as unknown as SessionRow | undefined;
  if (!row) return null;
  const expiresAt = new Date(row.expires_at);
  if (expiresAt.getTime() <= now.getTime()) {
    db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
    return null;
  }
  return {
    id,
    userId: row.user_id,
    createdAt: new Date(row.created_at),
    expiresAt,
    groupsCheckedAt: new Date(row.groups_checked_at),
    refreshToken: openOrNull(row.refresh_token_sealed, key),
    idToken: openOrNull(row.id_token_sealed, key),
  };
}

/** Records a groups check and replaces the sealed tokens that are provided. */
export function markGroupsChecked(
  db: DatabaseSync,
  id: string,
  tokens: { refreshToken?: string; idToken?: string },
  key: Buffer,
  now: Date,
): void {
  db.prepare(
    `UPDATE sessions SET
       groups_checked_at = ?,
       refresh_token_sealed = COALESCE(?, refresh_token_sealed),
       id_token_sealed = COALESCE(?, id_token_sealed)
     WHERE id_hash = ?`,
  ).run(
    now.toISOString(),
    sealOrNull(tokens.refreshToken, key),
    sealOrNull(tokens.idToken, key),
    hashSessionId(id),
  );
}

export function deleteSession(db: DatabaseSync, id: string): void {
  db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hashSessionId(id));
}

export function deleteUserSessions(db: DatabaseSync, userId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
