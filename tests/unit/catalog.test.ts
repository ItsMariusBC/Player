import { describe, expect, test } from "bun:test";
import {
  coverUrl,
  flattenCatalog,
  folderAncestors,
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
      picture: "/api/media/x1/cover",
      folderId: "A1",
      folderPath: ["Folder A", "Folder A1"],
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
    expect(coverUrl("abc")).toBe("/api/media/abc/cover");
  });
});
