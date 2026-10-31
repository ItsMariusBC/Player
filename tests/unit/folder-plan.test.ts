import { describe, expect, test } from "bun:test";
import type { FolderNode } from "../../lib/catalog";
import { planFolders } from "../../lib/folder-plan";

const node = (id: string, name: string, children: FolderNode[] = []): FolderNode => ({
  id,
  name,
  position: 0,
  children,
});

const tree = [node("rock", "Rock", [node("live", "Live")]), node("jazz", "Jazz")];

describe("planFolders", () => {
  test("creates nothing for files without a path and resolves to the root", () => {
    const plan = planFolders(tree, "jazz", [[]]);
    expect(plan.creates).toEqual([]);
    expect(plan.resolve.get("")).toBe("jazz");
  });

  test("reuses existing folders by name under the same parent", () => {
    const plan = planFolders(tree, null, [["Rock", "Live"]]);
    expect(plan.creates).toEqual([]);
    expect(plan.resolve.get("Rock/Live")).toBe("live");
  });

  test("creates missing folders in order, parented on existing ids", () => {
    const plan = planFolders(tree, null, [["Rock", "Studio", "Disc 1"]]);
    expect(plan.creates).toEqual([
      { key: "Rock/Studio", parentKey: "rock", name: "Studio" },
      { key: "Rock/Studio/Disc 1", parentKey: "Rock/Studio", name: "Disc 1" },
    ]);
    expect(plan.resolve.get("Rock/Studio/Disc 1")).toBe("Rock/Studio/Disc 1");
  });

  test("shares the common ancestors of sibling paths", () => {
    const plan = planFolders([], null, [
      ["A", "x"],
      ["A", "y"],
      ["A", "x"],
    ]);
    expect(plan.creates).toEqual([
      { key: "A", parentKey: null, name: "A" },
      { key: "A/x", parentKey: "A", name: "x" },
      { key: "A/y", parentKey: "A", name: "y" },
    ]);
  });

  test("looks up under the root folder and does not match a same name elsewhere", () => {
    const plan = planFolders(tree, "jazz", [["Live"]]);
    expect(plan.creates).toEqual([{ key: "Live", parentKey: "jazz", name: "Live" }]);
  });

  test("a created parent never matches existing children", () => {
    const plan = planFolders(tree, null, [["New", "Live"]]);
    expect(plan.creates.map((c) => c.key)).toEqual(["New", "New/Live"]);
  });
});
