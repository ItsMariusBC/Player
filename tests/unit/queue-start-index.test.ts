import { describe, expect, test } from "bun:test";
import { createQueueManager } from "../../lib/queue-manager";
import type { Song } from "../../lib/catalog";

const songs = ["a", "b", "c"].map((id) => ({ id, url: `/m/${id}` }) as Song);

describe("setSongs startIndex", () => {
  test("starts at the index with a single update", () => {
    const updates: (string | undefined)[] = [];
    const queue = createQueueManager({ onUpdate: (song) => updates.push(song?.id) });
    queue.setSongs(songs, 2);
    expect(queue.currentIndex).toBe(2);
    expect(updates).toEqual(["c"]);
  });

  test("falls back to 0 when out of range and is ignored once a track is current", () => {
    const queue = createQueueManager({});
    queue.setSongs(songs, 9);
    expect(queue.currentIndex).toBe(0);
    queue.setSongs(songs, 2);
    expect(queue.currentIndex).toBe(0);
  });
});
