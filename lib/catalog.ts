// lib/catalog.ts
// Client side of GET /api/catalog: wire types, media URLs and the flattened queue.
import { api } from "@/lib/api";
import { replayGain } from "@/lib/loudness";

// Mirrors of server/src/catalog/types.ts (FolderNode, TrackDto): keep both in sync.
export interface FolderNode {
  id: string;
  name: string;
  position: number;
  children: FolderNode[];
}

export interface TrackDto {
  id: string;
  folderId: string | null;
  title: string;
  artist: string;
  album: string;
  durationMs: number | null;
  format: "flac" | "mp3" | "wav";
  hasCover: boolean;
  position: number;
  /** Integrated loudness in LUFS; null while unmeasured (or from a server that does not send it). */
  loudnessLufs: number | null;
  /** True peak in dBTP; null while unmeasured. */
  truePeakDbtp: number | null;
  /** ISO timestamp; bumped by every edit, including a cover change (cache busting with ?v=). */
  updatedAt: string;
}

export interface Catalog {
  folders: FolderNode[];
  tracks: TrackDto[];
}

/** A playable track of the queue. */
export interface Song {
  id: string;
  name: string;
  author: string;
  album: string;
  /** Same-origin media URL, served behind the session cookie. */
  url: string;
  /** Cover URL, only when the track has one. */
  picture?: string;
  /** Null for root tracks (and tracks whose folder is unknown). */
  folderId: string | null;
  /** Folder names from the root down to the track's folder. */
  folderPath: string[];
  /** The track's updatedAt, carried so a replaced cover gets a new URL. */
  updatedAt: string;
  /** Playback gain in dB that evens out loudness (0 for an unmeasured track). */
  gainDb: number;
}

export const mediaUrl = (id: string) => `/api/media/${encodeURIComponent(id)}`;
/** With updatedAt, the URL changes after each edit, so a replaced cover is fetched again. */
export const coverUrl = (id: string, updatedAt?: string) =>
  `/api/media/${encodeURIComponent(id)}/cover` +
  (updatedAt ? `?v=${encodeURIComponent(updatedAt)}` : "");

export function fetchCatalog(): Promise<Catalog> {
  return api<Catalog>("/api/catalog");
}

function toSong(track: TrackDto, folderId: string | null, folderPath: string[]): Song {
  const song: Song = {
    id: track.id,
    name: track.title,
    author: track.artist,
    album: track.album,
    url: mediaUrl(track.id),
    folderId,
    folderPath,
    updatedAt: track.updatedAt,
    // Older servers omit the fields: treat them as unmeasured.
    gainDb: replayGain({ lufs: track.loudnessLufs ?? null, truePeakDbtp: track.truePeakDbtp ?? null }),
  };
  if (track.hasCover) song.picture = coverUrl(track.id, track.updatedAt);
  return song;
}

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

/**
 * Queue order. The same rule applies at every level, the root included:
 * subfolders first (depth-first, in tree order), then the level's own tracks
 * by position. Root tracks therefore come last. The song list renders in this
 * exact order so next/previous follow what is on screen.
 */
export function flattenCatalog(catalog: Catalog): Song[] {
  const tracksByFolder = new Map<string | null, TrackDto[]>();
  const known = new Set(folderAncestors(catalog.folders).keys());
  for (const track of catalog.tracks) {
    const key = track.folderId !== null && known.has(track.folderId) ? track.folderId : null;
    const list = tracksByFolder.get(key);
    if (list) list.push(track);
    else tracksByFolder.set(key, [track]);
  }

  const songs: Song[] = [];
  const emit = (folderId: string | null, path: string[]) => {
    const tracks = (tracksByFolder.get(folderId) ?? []).slice().sort(byPosition);
    for (const track of tracks) songs.push(toSong(track, folderId, path));
  };
  const visit = (nodes: FolderNode[], path: string[]) => {
    // The server already orders siblings by position: tree order is kept as is.
    for (const node of nodes) {
      const nodePath = [...path, node.name];
      visit(node.children, nodePath);
      emit(node.id, nodePath);
    }
  };
  visit(catalog.folders, []);
  emit(null, []);
  return songs;
}

/** Maps every folder id to the folder ids from the root down to it (itself included). */
export function folderAncestors(folders: FolderNode[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const visit = (nodes: FolderNode[], path: string[]) => {
    for (const node of nodes) {
      const nodePath = [...path, node.id];
      result.set(node.id, nodePath);
      visit(node.children, nodePath);
    }
  };
  visit(folders, []);
  return result;
}

/**
 * Opens every folder of `path` (an ancestor chain, deepest last) and closes the siblings of
 * each one, so a single folder is open per level: the queue tree works as an accordion.
 * `ancestors` comes from folderAncestors; folders absent from it are left as they are.
 */
export function openFolderPath(
  open: ReadonlySet<string>,
  path: readonly string[],
  ancestors: Map<string, string[]>,
): Set<string> {
  const next = new Set(open);
  const parentOf = (id: string) => {
    const chain = ancestors.get(id);
    return chain ? (chain[chain.length - 2] ?? null) : undefined;
  };
  for (const id of path) {
    const parent = parentOf(id);
    if (parent === undefined) continue;
    for (const other of next) {
      if (other !== id && parentOf(other) === parent) next.delete(other);
    }
    next.add(id);
  }
  return next;
}
