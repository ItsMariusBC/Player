// lib/admin-format.ts
// Pure helpers of the admin panel (folder labels, track order, durations). No React here,
// so the Bun unit tests import them directly.
import type {
  HealthReport,
  MaintenanceStatus,
  MetadataSearchResult,
  Proposal,
} from "@/lib/admin-api";
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

/** Delay before « Rechercher » can run again: the server allows one request per second per provider. */
export const METADATA_SEARCH_COOLDOWN_MS = 1000;

export interface MetadataResults {
  proposals: Proposal[];
  partial: boolean;
  /** The search was not run (rate limit): the previous proposals stay on screen. */
  retry: boolean;
}

/** What the dialog lists after a search answered. */
export function nextMetadataResults(
  previous: readonly Proposal[],
  result: MetadataSearchResult,
): MetadataResults {
  if (result.skipped) return { proposals: [...previous], partial: false, retry: true };
  return { proposals: result.proposals, partial: result.partial, retry: false };
}

/** The status line under the list, or null when the list speaks for itself. */
export function metadataResultsNotice(results: MetadataResults): string | null {
  if (results.retry) return "Réessayez dans un instant";
  if (results.proposals.length === 0) return "Aucune proposition";
  if (results.partial) return "Certains fournisseurs n'ont pas répondu";
  return null;
}

/**
 * Most tracks a batch action takes. Mirrors BATCH_MAX in server/src/routes/admin-tracks.ts:
 * keep the two values equal.
 */
export const BATCH_MAX = 200;

/** "1 titre sélectionné" / "n titres sélectionnés". */
export function selectionLabel(count: number): string {
  return count === 1 ? "1 titre sélectionné" : `${count} titres sélectionnés`;
}

/** Banner after a batch: "3 titres mis à jour, 1 introuvable". */
export function batchResultLabel(result: {
  updated?: number;
  deleted?: number;
  missing: number;
  failed?: number;
}): string {
  const done = result.deleted ?? result.updated ?? 0;
  const plural = done > 1;
  const verb = result.deleted === undefined ? "mis à jour" : plural ? "supprimés" : "supprimé";
  const base = `${done} titre${plural ? "s" : ""} ${verb}`;
  let label = base;
  if (result.missing > 0) {
    label += `, ${result.missing} introuvable${result.missing > 1 ? "s" : ""}`;
  }
  const failed = result.failed ?? 0;
  if (failed > 0) label += `, ${failed} échec${failed > 1 ? "s" : ""}`;
  return label;
}

/** "512 Mo", "1,2 Go", "0 o": binary units with French names, one decimal at most. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 o";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  return `${text.replace(".", ",")} ${units[unit]}`;
}

/** "Système : v1.2.3 · 12,4 Go libres · migrations 6/6", plus the reasons when degraded. */
export function healthLabel(report: HealthReport): string {
  const parts = [
    `Système : v${report.version}`,
    report.disk ? `${formatBytes(report.disk.freeBytes)} libres` : "espace disque inconnu",
    `migrations ${report.migrations.applied}/${report.migrations.expected}`,
  ];
  let label = parts.join(" · ");
  if (report.status === "degraded") label += ` · dégradé : ${report.reasons.join(", ")}`;
  return label;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "27/10/2026 14:05" in local time; the input as is when it is not a date. */
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** "Entretien : jamais lancé" or "Entretien : dernière passe 27/10/2026 14:05 (3 orphelins supprimés, 2 imports purgés)". */
export function maintenanceLabel(status: Pick<MaintenanceStatus, "lastRunAt" | "lastResult">): string {
  if (!status.lastRunAt) return "Entretien : jamais lancé";
  const when = formatDateTime(status.lastRunAt);
  const result = status.lastResult;
  if (!result) return `Entretien : dernière passe ${when}`;
  const orphans = result.orphanMedia + result.orphanIncoming;
  const orphanText = `${orphans} orphelin${orphans > 1 ? "s" : ""} supprimé${orphans > 1 ? "s" : ""}`;
  const importText = `${result.prunedImports} import${result.prunedImports > 1 ? "s" : ""} purgé${result.prunedImports > 1 ? "s" : ""}`;
  return `Entretien : dernière passe ${when} (${orphanText}, ${importText})`;
}
