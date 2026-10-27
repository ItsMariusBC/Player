import { describe, expect, test } from "bun:test";
import { createQueueManager, getTrackDirection } from "../../lib/queue-manager";
import type { Song } from "../../lib/catalog";

describe("getTrackDirection", () => {
  test.each([
    [0, 1, 5, "next"],
    [4, 0, 5, "next"],
    [3, 2, 5, "previous"],
    [0, 4, 5, "previous"],
    [0, 3, 5, "jump"],
    [2, 2, 5, "jump"],
    [0, 0, 1, "jump"],
    [0, 1, 2, "next"],
  ])("from %i to %i in %i songs is %s", (from, to, length, expected) => {
    expect(getTrackDirection(from, to, length)).toBe(expected as "next");
  });
});

const song = (id: string): Song => ({
  id,
  name: id,
  author: "A",
  album: "",
  url: `/api/media/${id}`,
  folderId: null,
  folderPath: [],
});

function setup() {
  const updates: (string | undefined)[] = [];
  const lists: string[][] = [];
  const queue = createQueueManager({
    onUpdate: (s) => updates.push(s?.id),
    onSongListUpdated: (songs) => lists.push(songs.map((s) => s.id)),
  });
  return { queue, updates, lists };
}

describe("queue manager", () => {
  test("first catalogue selects the first track", () => {
    const { queue, updates, lists } = setup();
    queue.setSongs([song("a"), song("b")]);
    expect(queue.getCurrentSong()?.id).toBe("a");
    expect(updates).toEqual(["a"]);
    expect(lists).toEqual([["a", "b"]]);
  });

  test("refresh keeps the current track by id without a track update", () => {
    const { queue, updates } = setup();
    queue.setSongs([song("a"), song("b"), song("c")]);
    queue.setIndex(1);
    queue.setSongs([song("z"), song("a"), song("c"), song("b")]);
    expect(queue.currentIndex).toBe(3);
    expect(queue.getCurrentSong()?.id).toBe("b");
    expect(updates).toEqual(["a", "b"]);
  });

  test("refresh without the current track clamps to the same index", () => {
    const { queue, updates } = setup();
    queue.setSongs([song("a"), song("b"), song("c")]);
    queue.setIndex(2);
    queue.setSongs([song("a"), song("b")]);
    expect(queue.getCurrentSong()?.id).toBe("b");
    expect(updates).toEqual(["a", "c", "b"]);
  });

  test("an empty catalogue clears the current track", () => {
    const { queue, updates } = setup();
    queue.setSongs([song("a")]);
    queue.setSongs([]);
    expect(queue.currentIndex).toBe(-1);
    expect(queue.getCurrentSong()).toBeUndefined();
    expect(updates).toEqual(["a", undefined]);
  });

  test("previous from the first track wraps to the last one", () => {
    const { queue } = setup();
    queue.setSongs([song("a"), song("b"), song("c")]);
    queue.previous();
    expect(queue.getCurrentSong()?.id).toBe("c");
    queue.next();
    expect(queue.getCurrentSong()?.id).toBe("a");
  });
});
