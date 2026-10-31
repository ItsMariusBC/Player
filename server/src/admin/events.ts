import type { DatabaseSync } from "node:sqlite";

export type AdminAction =
  | "folder_create"
  | "folder_update"
  | "folder_delete"
  | "track_update"
  | "track_delete"
  | "track_batch_update"
  | "track_batch_delete"
  | "cover_replace"
  | "metadata_apply"
  | "request_accept"
  | "request_delete"
  | "loudness_backfill";

/** One audit row per admin mutation; detail must never carry a secret. */
export function recordAdminEvent(
  db: DatabaseSync,
  event: {
    userId: string;
    action: AdminAction;
    trackId?: string;
    folderId?: string;
    detail: Record<string, unknown>;
  },
  now: Date,
): void {
  db.prepare(
    "INSERT INTO admin_events (id, user_id, action, track_id, folder_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    crypto.randomUUID(),
    event.userId,
    event.action,
    event.trackId ?? null,
    event.folderId ?? null,
    JSON.stringify(event.detail),
    now.toISOString(),
  );
}
