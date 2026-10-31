// lib/preload.ts
// Pure helper for the engine's double buffering: which song to load next.
import type { Song } from "@/lib/catalog";

/**
 * The song that follows `currentIndex` (wrapping around), or null when there
 * is nothing worth preloading: empty queue, single song, or no current index.
 */
export function nextToPreload(songs: readonly Song[], currentIndex: number): Song | null {
  if (songs.length < 2) return null;
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= songs.length) return null;
  return songs[(currentIndex + 1) % songs.length] ?? null;
}
