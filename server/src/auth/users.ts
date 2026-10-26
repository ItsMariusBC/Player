import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface UserRecord {
  id: string;
  issuer: string;
  subject: string;
  displayName: string | null;
  email: string | null;
  groups: string[];
}

interface UserRow {
  id: string;
  issuer: string;
  subject: string;
  display_name: string | null;
  email: string | null;
  groups: string;
}

/** Creates the user on first sight, otherwise refreshes its profile and groups. */
export function upsertUser(
  db: DatabaseSync,
  input: {
    issuer: string;
    subject: string;
    displayName?: string;
    email?: string;
    groups: string[];
  },
  now: Date,
): UserRecord {
  const stamp = now.toISOString();
  const row = db
    .prepare(
      `INSERT INTO users (id, issuer, subject, display_name, email, groups, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (issuer, subject) DO UPDATE SET
         display_name = excluded.display_name,
         email = excluded.email,
         groups = excluded.groups,
         last_seen_at = excluded.last_seen_at
       RETURNING id, issuer, subject, display_name, email, groups`,
    )
    .get(
      randomUUID(),
      input.issuer,
      input.subject,
      input.displayName ?? null,
      input.email ?? null,
      JSON.stringify(input.groups),
      stamp,
      stamp,
    ) as unknown as UserRow;
  return {
    id: row.id,
    issuer: row.issuer,
    subject: row.subject,
    displayName: row.display_name,
    email: row.email,
    groups: JSON.parse(row.groups) as string[],
  };
}

export function findUserById(db: DatabaseSync, id: string): UserRecord | null {
  const row = db
    .prepare("SELECT id, issuer, subject, display_name, email, groups FROM users WHERE id = ?")
    .get(id) as unknown as UserRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    issuer: row.issuer,
    subject: row.subject,
    displayName: row.display_name,
    email: row.email,
    groups: JSON.parse(row.groups) as string[],
  };
}
