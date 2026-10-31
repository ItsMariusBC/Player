import { describe, expect, test } from "bun:test";
import {
  coverUrl,
  flattenCatalog,
  folderAncestors,
  openFolderPath,
  mediaUrl,
  type Catalog,
  type FolderNode,
  type TrackDto,
} from "../../lib/catalog";

const folder = (id: string, position: number, children: FolderNode[] = []): FolderNode => ({
  id,
  name: `Folder ${id}`,
  position,
  children,
});

const track = (
  id: string,
  folderId: string | null,
  position: number,
  hasCover = false,
): TrackDto => ({
  id,
  folderId,
  title: `T${id}`,
  artist: "Artist",
  album: "Album",
  durationMs: 1000,
  format: "mp3",
  hasCover,
  position,
  loudnessLufs: null,
  truePeakDbtp: null,
  hasLight: false,
  updatedAt: "2026-10-27T00:00:00.000Z",
});

// Tree: A (with child A1), B. Tracks are given out of order on purpose.
const catalog: Catalog = {
  folders: [folder("A", 0, [folder("A1", 0)]), folder("B", 1)],
  tracks: [
    track("r1", null, 1),
    track("b1", "B", 0),
    track("a2", "A", 1),
    track("a1", "A", 0),
    track("r0", null, 0),
    track("x1", "A1", 0, true),
  ],
};

describe("flattenCatalog", () => {
  test("depth-first in tree order, subfolders before a folder's own tracks, root last", () => {
    expect(flattenCatalog(catalog).map((s) => s.id)).toEqual(["x1", "a1", "a2", "b1", "r0", "r1"]);
  });

  test("folderPath lists folder names from the root", () => {
    const byId = new Map(flattenCatalog(catalog).map((s) => [s.id, s]));
    expect(byId.get("x1")?.folderPath).toEqual(["Folder A", "Folder A1"]);
    expect(byId.get("a1")?.folderPath).toEqual(["Folder A"]);
    expect(byId.get("r0")?.folderPath).toEqual([]);
    expect(byId.get("r0")?.folderId).toBeNull();
  });

  test("maps a track to a song with media and cover URLs", () => {
    const [first] = flattenCatalog(catalog);
    expect(first).toEqual({
      id: "x1",
      name: "Tx1",
      author: "Artist",
      album: "Album",
      url: "/api/media/x1",
      picture: "/api/media/x1/cover?v=2026-10-27T00%3A00%3A00.000Z",
      folderId: "A1",
      folderPath: ["Folder A", "Folder A1"],
      updatedAt: "2026-10-27T00:00:00.000Z",
      gainDb: 0,
    });
    const withoutCover = flattenCatalog(catalog).find((s) => s.id === "a1");
    expect(withoutCover && "picture" in withoutCover).toBe(false);
  });

  test("tracks of an unknown folder are listed with the root tracks", () => {
    const songs = flattenCatalog({ folders: [], tracks: [track("o", "gone", 0)] });
    expect(songs.map((s) => [s.id, s.folderId, s.folderPath])).toEqual([["o", null, []]]);
  });

  test("empty catalogue", () => {
    expect(flattenCatalog({ folders: [], tracks: [] })).toEqual([]);
  });
});

describe("folderAncestors", () => {
  test("maps each folder to the ids from the root down to itself", () => {
    const ancestors = folderAncestors(catalog.folders);
    expect(ancestors.get("A1")).toEqual(["A", "A1"]);
    expect(ancestors.get("B")).toEqual(["B"]);
  });
});

describe("media URLs", () => {
  test("are same-origin API paths", () => {
    expect(mediaUrl("abc")).toBe("/api/media/abc");
    expect(mediaUrl("abc", "max")).toBe("/api/media/abc");
    expect(mediaUrl("abc", "light")).toBe("/api/media/abc?q=light");
    expect(mediaUrl("a b", "light")).toBe("/api/media/a%20b?q=light");
    expect(coverUrl("abc")).toBe("/api/media/abc/cover");
  });

  test("the cover URL carries updatedAt as a cache buster", () => {
    expect(coverUrl("a b", "2026-10-27T10:00:00.000Z")).toBe(
      "/api/media/a%20b/cover?v=2026-10-27T10%3A00%3A00.000Z",
    );
  });
});

describe("openFolderPath", () => {
  const folders = [
    {
      id: "a",
      name: "A",
      position: 0,
      children: [
        { id: "a1", name: "A1", position: 0, children: [] },
        { id: "a2", name: "A2", position: 1, children: [] },
      ],
    },
    { id: "b", name: "B", position: 1, children: [] },
  ];
  const ancestors = folderAncestors(folders);

  test("opens the folder and closes its siblings", () => {
    const next = openFolderPath(new Set(["a"]), ["b"], ancestors);
    expect([...next]).toEqual(["b"]);
  });

  test("opens a whole path, one folder per level", () => {
    const next = openFolderPath(new Set(["b", "a2"]), ["a", "a1"], ancestors);
    expect([...next].sort()).toEqual(["a", "a1"]);
  });

  test("keeps folders on other levels open", () => {
    const next = openFolderPath(new Set(["a", "a1"]), ["a2"], ancestors);
    expect([...next].sort()).toEqual(["a", "a2"]);
  });

  test("ignores unknown folders", () => {
    const next = openFolderPath(new Set(["a"]), ["zz"], ancestors);
    expect([...next]).toEqual(["a"]);
  });
});

describe("Song.gainDb", () => {
  const one = (extra: Partial<TrackDto>): number => {
    const dto = { ...track("g", null, 0), ...extra };
    return flattenCatalog({ folders: [], tracks: [dto] })[0]!.gainDb;
  };
  test("0 dB for an unmeasured track", () => {
    expect(one({})).toBe(0);
  });
  test("0 dB when the server omits the fields", () => {
    const dto = track("g", null, 0) as Partial<TrackDto>;
    delete dto.loudnessLufs;
    delete dto.truePeakDbtp;
    expect(flattenCatalog({ folders: [], tracks: [dto as TrackDto] })[0]!.gainDb).toBe(0);
  });
  test("target minus loudness for a measured track", () => {
    expect(one({ loudnessLufs: -20, truePeakDbtp: -10 })).toBe(6);
  });
});
