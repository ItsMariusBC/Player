import { describe, expect, test } from "bun:test";
import {
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
