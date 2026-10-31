import type { DatabaseSync } from "node:sqlite";

let depth = 0;

/**
 * Runs fn atomically. Savepoints nest, so a route can wrap several repository calls
 * that are each transactional on their own. fn must be synchronous.
 */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  const name = `sp_${depth}`;
  db.exec(`SAVEPOINT ${name}`);
  depth++;
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (error) {
    try {
      db.exec(`ROLLBACK TO ${name}`);
      db.exec(`RELEASE ${name}`);
    } catch {
      // SQLite may already have rolled the whole transaction back (RAISE(ROLLBACK),
      // SQLITE_FULL): the savepoint is gone, and the original error is the one that matters.
    }
    throw error;
  } finally {
    depth--;
  }
}
