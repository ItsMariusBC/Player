import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFolderTree } from "../src/catalog/tree.ts";

describe("buildFolderTree", () => {
  it("nests children and sorts siblings by position", () => {
    const tree = buildFolderTree([
      { id: "c", parentId: "a", name: "C", position: 1 },
      { id: "b", parentId: "a", name: "B", position: 0 },
      { id: "z", parentId: null, name: "Z", position: 1 },
      { id: "a", parentId: null, name: "A", position: 0 },
      { id: "d", parentId: "b", name: "D", position: 0 },
    ]);
    assert.deepEqual(tree, [
      {
        id: "a",
        name: "A",
        position: 0,
        children: [
          {
            id: "b",
            name: "B",
            position: 0,
            children: [{ id: "d", name: "D", position: 0, children: [] }],
          },
          { id: "c", name: "C", position: 1, children: [] },
        ],
      },
      { id: "z", name: "Z", position: 1, children: [] },
    ]);
  });
  it("returns an empty list for no folders", () => {
    assert.deepEqual(buildFolderTree([]), []);
  });
});
