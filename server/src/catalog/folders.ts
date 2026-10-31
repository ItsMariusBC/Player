import type { DatabaseSync } from "node:sqlite";
import { renumber } from "./tracks.ts";
import { inTransaction } from "./tx.ts";
import {
  FolderConflictError,
  FolderCycleError,
  FolderNotEmptyError,
  NotFoundError,
  type FolderRecord,
} from "./types.ts";

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  position: number;
}

function toRecord(row: FolderRow): FolderRecord {
  return { id: row.id, parentId: row.parent_id, name: row.name, position: row.position };
}

export function getFolder(db: DatabaseSync, id: string): FolderRecord | null {
  const row = db
    .prepare("SELECT id, parent_id, name, position FROM folders WHERE id = ?")
    .get(id) as unknown as FolderRow | undefined;
  return row ? toRecord(row) : null;
}

function requireFolder(db: DatabaseSync, id: string): FolderRecord {
  const folder = getFolder(db, id);
  if (!folder) throw new NotFoundError("Folder not found");
  return folder;
}

/** Folders ordered by parent then position. */
export function listFolders(db: DatabaseSync): FolderRecord[] {
  const rows = db
    .prepare(
      "SELECT id, parent_id, name, position FROM folders ORDER BY parent_id, position, created_at, rowid",
    )
    .all() as unknown as FolderRow[];
  return rows.map(toRecord);
}

/** True when candidateId sits below ancestorId in the tree (a folder is not its own descendant). */
export function isDescendant(
  folders: FolderRecord[],
  candidateId: string,
  ancestorId: string,
): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  let current = byId.get(candidateId)?.parentId ?? null;
  while (current !== null && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

// SQLite treats NULLs as distinct in UNIQUE(parent_id, name), so names are checked here for every parent.
function assertNameFree(
  db: DatabaseSync,
  parentId: string | null,
  name: string,
  exceptId?: string,
): void {
  const row = db
    .prepare("SELECT id FROM folders WHERE parent_id IS ? AND name = ? AND id IS NOT ?")
    .get(parentId, name, exceptId ?? null);
  if (row) throw new FolderConflictError();
}

function nextPosition(db: DatabaseSync, parentId: string | null): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM folders WHERE parent_id IS ?")
    .get(parentId) as unknown as { next: number };
  return row.next;
}

function siblingIds(db: DatabaseSync, parentId: string | null): string[] {
  const rows = db
    .prepare("SELECT id FROM folders WHERE parent_id IS ? ORDER BY position, created_at, rowid")
    .all(parentId) as unknown as { id: string }[];
  return rows.map((row) => row.id);
}

function renumberFolders(db: DatabaseSync, parentId: string | null): void {
  const update = db.prepare("UPDATE folders SET position = ? WHERE id = ?");
  siblingIds(db, parentId).forEach((id, index) => update.run(index, id));
}

export function createFolder(
  db: DatabaseSync,
  input: { parentId: string | null; name: string },
  now: Date,
): FolderRecord {
  if (input.parentId !== null) requireFolder(db, input.parentId);
  assertNameFree(db, input.parentId, input.name);
  const folder: FolderRecord = {
    id: crypto.randomUUID(),
    parentId: input.parentId,
    name: input.name,
    position: nextPosition(db, input.parentId),
  };
  db.prepare(
    "INSERT INTO folders (id, parent_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(folder.id, folder.parentId, folder.name, folder.position, now.toISOString());
  return folder;
}

export function renameFolder(db: DatabaseSync, id: string, name: string, _now: Date): FolderRecord {
  const folder = requireFolder(db, id);
  assertNameFree(db, folder.parentId, name, id);
  db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(name, id);
  return { ...folder, name };
}

/**
 * Moves a folder under parentId (null is the root). Without a position it goes to the end
 * of its new parent, or stays in place when the parent does not change; siblings are renumbered.
 */
export function moveFolder(
  db: DatabaseSync,
  id: string,
  parentId: string | null,
  _now: Date,
  position?: number,
): FolderRecord {
  const folder = requireFolder(db, id);
  if (parentId !== null) {
    requireFolder(db, parentId);
    if (parentId === id || isDescendant(listFolders(db), parentId, id)) {
      throw new FolderCycleError();
    }
  }
  const sameParent = parentId === folder.parentId;
  if (sameParent && position === undefined) return folder;
  if (!sameParent) assertNameFree(db, parentId, folder.name, id);
  return inTransaction(db, () => {
    const siblings = siblingIds(db, parentId).filter((siblingId) => siblingId !== id);
    const index =
      position === undefined ? siblings.length : Math.max(0, Math.min(position, siblings.length));
    siblings.splice(index, 0, id);
    db.prepare("UPDATE folders SET parent_id = ? WHERE id = ?").run(parentId, id);
    const update = db.prepare("UPDATE folders SET position = ? WHERE id = ?");
    siblings.forEach((siblingId, at) => update.run(at, siblingId));
    if (!sameParent) renumberFolders(db, folder.parentId);
    return { ...folder, parentId, position: index };
  });
}

/** Without force the folder must be empty; with force its content moves up to the parent. */
export function deleteFolder(db: DatabaseSync, id: string, opts: { force: boolean }): void {
  const folder = requireFolder(db, id);
  const trackIds = db
    .prepare("SELECT id FROM tracks WHERE folder_id = ? ORDER BY position, created_at, rowid")
    .all(id) as unknown as { id: string }[];
  const children = db
    .prepare(
      "SELECT id, name FROM folders WHERE parent_id = ? ORDER BY position, created_at, rowid",
    )
    .all(id) as unknown as { id: string; name: string }[];
  if (!opts.force) {
    if (trackIds.length > 0 || children.length > 0) throw new FolderNotEmptyError();
    inTransaction(db, () => {
      db.prepare("DELETE FROM folders WHERE id = ?").run(id);
      renumberFolders(db, folder.parentId);
    });
    return;
  }
  for (const child of children) assertNameFree(db, folder.parentId, child.name, id);
  inTransaction(db, () => {
    const trackBase = (
      db
        .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM tracks WHERE folder_id IS ?")
        .get(folder.parentId) as unknown as { next: number }
    ).next;
    const moveTrackRow = db.prepare("UPDATE tracks SET folder_id = ?, position = ? WHERE id = ?");
    trackIds.forEach((track, index) =>
      moveTrackRow.run(folder.parentId, trackBase + index, track.id),
    );
    const folderBase = nextPosition(db, folder.parentId);
    const moveChild = db.prepare("UPDATE folders SET parent_id = ?, position = ? WHERE id = ?");
    children.forEach((child, index) =>
      moveChild.run(folder.parentId, folderBase + index, child.id),
    );
    db.prepare("DELETE FROM folders WHERE id = ?").run(id);
    renumberFolders(db, folder.parentId);
    renumber(db, folder.parentId);
  });
}
