import { describe, expect, test } from "bun:test";
import { groupByFolder } from "../../components/song-list";
import type { QueueItem } from "../../lib/queue-manager";

const item = (id: number, folder?: string): QueueItem => ({
  id,
  name: `S${id}`,
  author: "A",
  url: `/${id}.mp3`,
  folder,
});

describe("groupByFolder", () => {
  test("keeps folders in first-appearance order and root songs last", () => {
    const groups = groupByFolder([item(0, "B"), item(1), item(2, "A"), item(3, "B")]);
    expect(groups.map((g) => g.folder)).toEqual(["B", "A", null]);
    expect(groups[0].songs.map((s) => s.id)).toEqual([0, 3]);
    expect(groups[2].songs.map((s) => s.id)).toEqual([1]);
  });

  test("no root group when every song has a folder", () => {
    expect(groupByFolder([item(0, "A")]).map((g) => g.folder)).toEqual(["A"]);
  });
});
