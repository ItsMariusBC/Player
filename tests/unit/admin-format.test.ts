import { describe, expect, test } from "bun:test";
import {
  batchResultLabel,
  selectionLabel,
  metadataResultsNotice,
  nextMetadataResults,
  isMetadataQueryValid,
  metadataQuery,
  proposalDetails,
  buildFolderPathLabel,
  countFolderItems,
  findFolder,
  flattenFolderOptions,
  formatDuration,
  INBOX_LABEL,
  sortTracksByPosition,
  tagsStatusLabel,
  tracksInFolder,
} from "../../lib/admin-format";
import type { FolderNode, TrackDto } from "../../lib/catalog";

const folder = (id: string, name: string, children: FolderNode[] = []): FolderNode => ({
  id,
  name,
  position: 0,
  children,
});

const track = (id: string, folderId: string | null, position: number, title = id): TrackDto => ({
  id,
  folderId,
  title,
  artist: "",
  album: "",
  durationMs: null,
  format: "flac",
  hasCover: false,
  loudnessLufs: null,
  truePeakDbtp: null,
  position,
  updatedAt: "2026-10-27T00:00:00.000Z",
});

// Tree: Rock (Live), Jazz.
const folders = [folder("rock", "Rock", [folder("live", "Live")]), folder("jazz", "Jazz")];

describe("buildFolderPathLabel", () => {
  test("joins the names from the root down to the folder", () => {
    expect(buildFolderPathLabel(folders, "live")).toBe("Rock / Live");
    expect(buildFolderPathLabel(folders, "jazz")).toBe("Jazz");
  });

  test("null and unknown folders are the inbox", () => {
    expect(buildFolderPathLabel(folders, null)).toBe(INBOX_LABEL);
    expect(buildFolderPathLabel(folders, "gone")).toBe(INBOX_LABEL);
    expect(INBOX_LABEL).toBe("Boîte d'arrivée");
  });
});

describe("findFolder", () => {
  test("finds a nested folder and misses an unknown one", () => {
    expect(findFolder(folders, "live")?.name).toBe("Live");
    expect(findFolder(folders, "gone")).toBeUndefined();
  });
});

describe("flattenFolderOptions", () => {
  test("lists every folder in tree order with its depth and path", () => {
    expect(flattenFolderOptions(folders)).toEqual([
      { id: "rock", name: "Rock", label: "Rock", depth: 0 },
      { id: "live", name: "Live", label: "Rock / Live", depth: 1 },
      { id: "jazz", name: "Jazz", label: "Jazz", depth: 0 },
    ]);
  });
});

describe("sortTracksByPosition", () => {
  test("orders by position, ties by title then id, without mutating the input", () => {
    const input = [track("c", null, 2), track("b", null, 0, "Zed"), track("a", null, 0, "Abc")];
    expect(sortTracksByPosition(input).map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(input.map((t) => t.id)).toEqual(["c", "b", "a"]);
  });
});

describe("tracksInFolder", () => {
  const tracks = [
    track("r2", "rock", 1),
    track("r1", "rock", 0),
    track("i1", null, 0),
    track("o1", "gone", 0),
    track("l1", "live", 0),
  ];

  test("returns the folder's own tracks sorted by position", () => {
    expect(tracksInFolder(folders, tracks, "rock").map((t) => t.id)).toEqual(["r1", "r2"]);
  });

  test("the inbox holds tracks without a folder or with an unknown folder", () => {
    expect(tracksInFolder(folders, tracks, null).map((t) => t.id)).toEqual(["i1", "o1"]);
  });
});

describe("countFolderItems", () => {
  test("counts the direct subfolders and tracks", () => {
    const tracks = [track("r1", "rock", 0), track("l1", "live", 0)];
    expect(countFolderItems(folders, tracks, "rock")).toBe(2);
    expect(countFolderItems(folders, tracks, "jazz")).toBe(0);
  });
});

describe("formatDuration", () => {
  test("formats milliseconds as mm:ss", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(65_400)).toBe("01:05");
    expect(formatDuration(3_600_000)).toBe("60:00");
  });

  test("unknown duration", () => {
    expect(formatDuration(null)).toBe("--:--");
  });
});

describe("tagsStatusLabel", () => {
  test("written, not written for a WAV, not written otherwise", () => {
    expect(tagsStatusLabel(true, "flac")).toBe("Tags écrits dans le fichier");
    expect(tagsStatusLabel(false, "wav")).toBe("Tags non écrits (WAV)");
    expect(tagsStatusLabel(false, "mp3")).toBe("Tags non écrits");
  });
});

describe("metadata dialog helpers", () => {
  test("metadataQuery joins title and artist, or keeps the title alone", () => {
    expect(metadataQuery({ title: " Clair de lune ", artist: "Debussy " })).toBe(
      "Clair de lune Debussy",
    );
    expect(metadataQuery({ title: "Sans artiste", artist: "  " })).toBe("Sans artiste");
    expect(metadataQuery({ title: "x".repeat(150), artist: "y".repeat(100) }).length).toBe(200);
  });

  test("isMetadataQueryValid follows the server bounds on the trimmed query", () => {
    expect(isMetadataQueryValid("ab")).toBe(true);
    expect(isMetadataQueryValid(" a ")).toBe(false);
    expect(isMetadataQueryValid("x".repeat(200))).toBe(true);
    expect(isMetadataQueryValid("x".repeat(201))).toBe(false);
  });

  test("proposalDetails lists album, year and source when present", () => {
    const base = { id: "p", title: "T", artist: "A", coverUrl: null };
    expect(proposalDetails({ ...base, source: "deezer", album: "Disque", year: 1905 })).toBe(
      "Disque · 1905 · Deezer",
    );
    expect(proposalDetails({ ...base, source: "musicbrainz", album: null, year: null })).toBe(
      "MusicBrainz",
    );
  });
});

describe("metadata results state", () => {
  const proposal = (id: string) => ({
    id,
    source: "deezer" as const,
    title: "T",
    artist: "A",
    album: null,
    year: null,
    coverUrl: null,
  });

  test("a skipped search keeps the previous proposals and asks to retry", () => {
    const previous = [proposal("a")];
    const results = nextMetadataResults(previous, { proposals: [], partial: true, skipped: true });
    expect(results).toEqual({ proposals: previous, partial: false, retry: true });
    expect(metadataResultsNotice(results)).toBe("Réessayez dans un instant");
    expect(
      metadataResultsNotice(
        nextMetadataResults([], { proposals: [], partial: true, skipped: true }),
      ),
    ).toBe("Réessayez dans un instant");
  });

  test("an answered search replaces the list", () => {
    const fresh = [proposal("b")];
    expect(nextMetadataResults([proposal("a")], { proposals: fresh, partial: false })).toEqual({
      proposals: fresh,
      partial: false,
      retry: false,
    });
  });

  test("the notice says empty, partial or nothing", () => {
    expect(metadataResultsNotice({ proposals: [], partial: true, retry: false })).toBe(
      "Aucune proposition",
    );
    expect(metadataResultsNotice({ proposals: [proposal("a")], partial: true, retry: false })).toBe(
      "Certains fournisseurs n'ont pas répondu",
    );
    expect(
      metadataResultsNotice({ proposals: [proposal("a")], partial: false, retry: false }),
    ).toBe(null);
  });
});

describe("batch labels", () => {
  test("selectionLabel pluralizes", () => {
    expect(selectionLabel(1)).toBe("1 titre sélectionné");
    expect(selectionLabel(3)).toBe("3 titres sélectionnés");
  });

  test("batchResultLabel", () => {
    expect(batchResultLabel({ updated: 1, missing: 0 })).toBe("1 titre mis à jour");
    expect(batchResultLabel({ updated: 4, missing: 0 })).toBe("4 titres mis à jour");
    expect(batchResultLabel({ deleted: 1, missing: 0 })).toBe("1 titre supprimé");
    expect(batchResultLabel({ deleted: 2, missing: 1 })).toBe("2 titres supprimés, 1 introuvable");
    expect(batchResultLabel({ updated: 2, missing: 3 })).toBe(
      "2 titres mis à jour, 3 introuvables",
    );
  });
});
