import { describe, expect, test } from "bun:test";
import { nextToPreload } from "../../lib/preload";
import type { Song } from "../../lib/catalog";

const song = (id: string): Song => ({ id, url: `/api/media/${id}` }) as unknown as Song;
const songs = ["a", "b", "c"].map(song);

describe("nextToPreload", () => {
  test("returns the following song", () => {
    expect(nextToPreload(songs, 0)?.id).toBe("b");
    expect(nextToPreload(songs, 1)?.id).toBe("c");
  });
  test("wraps around at the end of the queue", () => {
    expect(nextToPreload(songs, 2)?.id).toBe("a");
  });
  test("returns null for an empty queue or a single song", () => {
    expect(nextToPreload([], 0)).toBeNull();
    expect(nextToPreload([song("a")], 0)).toBeNull();
  });
  test("returns null for an invalid current index", () => {
    expect(nextToPreload(songs, -1)).toBeNull();
    expect(nextToPreload(songs, 3)).toBeNull();
    expect(nextToPreload(songs, 1.5)).toBeNull();
  });
});
