// lib/admin-format.ts
// Pure helpers of the admin panel (folder labels, track order, durations). No React here,
// so the Bun unit tests import them directly.
import type { Proposal } from "@/lib/admin-api";
import { folderAncestors, type FolderNode, type TrackDto } from "@/lib/catalog";

export const INBOX_LABEL = "Boîte d'arrivée";

/** dataTransfer type of a track row dragged onto a folder. */
export const TRACK_DRAG_TYPE = "text/x-track-id";

export interface FolderOption {
  id: string;
  name: string;
  /** Full path, e.g. "Rock / Live". */
  label: string;
  depth: number;
}

/** Every folder in tree order, with its depth and full path (the "Déplacer vers…" list). */
export function flattenFolderOptions(folders: FolderNode[]): FolderOption[] {
  const options: FolderOption[] = [];
  const visit = (nodes: FolderNode[], path: string[]) => {
    for (const node of nodes) {
      const nodePath = [...path, node.name];
      options.push({ id: node.id, name: node.name, label: nodePath.join(" / "), depth: path.length });
      visit(node.children, nodePath);
    }
  };
  visit(folders, []);
  return options;
}

export function findFolder(folders: FolderNode[], id: string): FolderNode | undefined {
  for (const node of folders) {
    if (node.id === id) return node;
    const found = findFolder(node.children, id);
    if (found) return found;
  }
  return undefined;
}

/** "Rock / Live" for a folder; the inbox label for null or a folder that no longer exists. */
export function buildFolderPathLabel(folders: FolderNode[], folderId: string | null): string {
  if (folderId === null) return INBOX_LABEL;
  return flattenFolderOptions(folders).find((option) => option.id === folderId)?.label ?? INBOX_LABEL;
}

/** Position order (the queue's order); ties by title then id so the table never jumps. */
export function sortTracksByPosition(tracks: readonly TrackDto[]): TrackDto[] {
  return tracks
    .slice()
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.title.localeCompare(b.title, "fr") ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/**
 * The tracks shown for a folder, sorted. The inbox (null) also holds tracks whose folder is
 * unknown, as the player does (flattenCatalog).
 */
export function tracksInFolder(
  folders: FolderNode[],
  tracks: readonly TrackDto[],
  folderId: string | null,
): TrackDto[] {
  const known = folderAncestors(folders);
  return sortTracksByPosition(
    tracks.filter((track) => {
      const effective = track.folderId !== null && known.has(track.folderId) ? track.folderId : null;
      return effective === folderId;
    }),
  );
}

/** Direct subfolders plus direct tracks: what a forced delete lifts into the parent. */
export function countFolderItems(
  folders: FolderNode[],
  tracks: readonly TrackDto[],
  folderId: string,
): number {
  const node = findFolder(folders, folderId);
  if (!node) return 0;
  return node.children.length + tracks.filter((track) => track.folderId === folderId).length;
}

/** mm:ss from milliseconds; "--:--" when the duration is unknown. */
export function formatDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return "--:--";
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Outcome of a tag save. tagsWritten is also false for a failed MP3/FLAC write or a sha
 * collision, so « (WAV) » is only said of a WAV file.
 */
export function tagsStatusLabel(tagsWritten: boolean, format: TrackDto["format"]): string {
  if (tagsWritten) return "Tags écrits dans le fichier";
  return format === "wav" ? "Tags non écrits (WAV)" : "Tags non écrits";
}

/** Query bounds of GET /api/admin/metadata/search. */
export const METADATA_QUERY_MIN = 2;
export const METADATA_QUERY_MAX = 200;

/** Prefill of the metadata search: "title artist", the title alone when there is no artist. */
export function metadataQuery(track: Pick<TrackDto, "title" | "artist">): string {
  const query = [track.title, track.artist]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" ");
  return query.slice(0, METADATA_QUERY_MAX).trim();
}

export function isMetadataQueryValid(query: string): boolean {
  const length = query.trim().length;
  return length >= METADATA_QUERY_MIN && length <= METADATA_QUERY_MAX;
}

export const PROPOSAL_SOURCE_LABELS: Record<Proposal["source"], string> = {
  musicbrainz: "MusicBrainz",
  deezer: "Deezer",
  itunes: "iTunes",
};

/** "Album · 1905 · Deezer": the parts that exist, in that order. */
export function proposalDetails(proposal: Proposal): string {
  return [proposal.album, proposal.year?.toString(), PROPOSAL_SOURCE_LABELS[proposal.source]]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}
