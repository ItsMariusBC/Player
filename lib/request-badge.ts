// lib/request-badge.ts
// « Nouveautés » badge of the request button: when the user last opened the requests modal,
// and how many of their requests changed since. Storage is injected so Bun tests stay pure.
import type { SongRequestDto } from "@/lib/requests-api";

const REQUESTS_SEEN_PREFIX = "player.requests.seen.v1";

/** One key per user, so two accounts sharing a browser do not hide each other's news. */
export const seenKey = (userId: string): string => `${REQUESTS_SEEN_PREFIX}:${userId}`;

export interface SeenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): SeenStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** ISO date of the last opening, or null when never opened or storage is unavailable. */
export function readSeenAt(
  userId: string,
  storage: SeenStorage | null = defaultStorage(),
): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(seenKey(userId));
    return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
  } catch {
    return null;
  }
}

/** Records now (epoch milliseconds) as the last opening; best effort. */
export function markSeen(
  userId: string,
  storage: SeenStorage | null = defaultStorage(),
  now = Date.now(),
): void {
  if (!storage) return;
  try {
    storage.setItem(seenKey(userId), new Date(now).toISOString());
  } catch {
    // Private mode or blocked storage: the badge is best effort.
  }
}

/** Requests no longer pending whose last change is after seenAt (all of them when never seen). */
export function unseenRequestChanges(
  requests: readonly Pick<SongRequestDto, "status" | "updatedAt">[],
  seenAt: string | null,
): number {
  const seen = seenAt === null ? Number.NEGATIVE_INFINITY : Date.parse(seenAt);
  return requests.filter(
    (request) =>
      request.status !== "pending" &&
      (Number.isNaN(seen) || Date.parse(request.updatedAt) > seen),
  ).length;
}
