import { describe, expect, test } from "bun:test";
import {
  type DropEntry,
  MAX_DROP_VISITS,
  collectDroppedFiles,
  fromFileList,
} from "../../lib/drop-entries";

const file = (name: string): DropEntry => ({
  isFile: true,
  isDirectory: false,
  name,
  file: async () => ({ name, size: 1 }),
  readEntries: async () => [],
});

/** Answers the children in chunks of `chunk`, then an empty batch, like the DOM reader. */
const dir = (name: string, children: DropEntry[], chunk = 2): DropEntry => {
  let offset = 0;
  return {
    isFile: false,
    isDirectory: true,
    name,
    file: async () => {
      throw new Error("directory");
    },
    readEntries: async () => {
      const batch = children.slice(offset, offset + chunk);
      offset += chunk;
      return batch;
    },
  };
};

const names = (result: { files: { file: { name: string }; path: string[] }[] }) =>
  result.files.map((f) => [...f.path, f.file.name].join("/"));

describe("collectDroppedFiles", () => {
  test("walks nested folders and keeps the relative path", async () => {
    const tree = dir("Album", [file("a.flac"), dir("Disc 2", [file("b.mp3")]), file("c.WAV")]);
    const result = await collectDroppedFiles([tree]);
    expect(names(result).sort()).toEqual(["Album/Disc 2/b.mp3", "Album/a.flac", "Album/c.WAV"]);
    expect(result.tooMany).toBe(false);
  });

  test("loose files have an empty path", async () => {
    const result = await collectDroppedFiles([file("x.mp3")]);
    expect(result.files[0]?.path).toEqual([]);
  });

  test("reads every chunk of a directory", async () => {
    const children = ["1", "2", "3", "4", "5"].map((n) => file(`${n}.mp3`));
    const result = await collectDroppedFiles([dir("D", children, 2)]);
    expect(result.files).toHaveLength(5);
  });

  test("filters extensions and hidden names", async () => {
    const tree = dir("D", [
      file("cover.jpg"),
      file(".hidden.mp3"),
      file("notes.txt"),
      dir(".git", [file("x.mp3")]),
      file("ok.FLAC"),
    ]);
    expect(names(await collectDroppedFiles([tree]))).toEqual(["D/ok.FLAC"]);
  });

  test("stops at maxDepth", async () => {
    const deep = dir("a", [dir("b", [dir("c", [file("x.mp3")])]), file("y.mp3")]);
    const result = await collectDroppedFiles([deep], { maxDepth: 2 });
    expect(names(result)).toEqual(["a/y.mp3"]);
  });

  test("flags too many files and returns none", async () => {
    const children = Array.from({ length: 4 }, (_, i) => file(`${i}.mp3`));
    const result = await collectDroppedFiles([dir("D", children)], { maxFiles: 3 });
    expect(result).toEqual({ files: [], tooMany: true });
  });

  test("flags too many visited entries, audio or not", async () => {
    const children = Array.from({ length: 5 }, (_, i) => file(`${i}.txt`));
    const result = await collectDroppedFiles([dir("D", [file("a.mp3"), ...children])], {
      maxVisits: 4,
    });
    expect(result).toEqual({ files: [], tooMany: true });
  });

  test("accepts exactly maxVisits entries", async () => {
    const result = await collectDroppedFiles([dir("D", [file("a.mp3"), file("b.txt")])], {
      maxVisits: 3,
    });
    expect(result.tooMany).toBe(false);
    expect(names(result)).toEqual(["D/a.mp3"]);
  });

  test("exports the default visit budget", () => {
    expect(MAX_DROP_VISITS).toBe(10_000);
  });

  test("accepts exactly maxFiles", async () => {
    const children = Array.from({ length: 3 }, (_, i) => file(`${i}.mp3`));
    const result = await collectDroppedFiles([dir("D", children)], { maxFiles: 3 });
    expect(result.tooMany).toBe(false);
    expect(result.files).toHaveLength(3);
  });
});

describe("fromFileList", () => {
  const f = (name: string, webkitRelativePath?: string) => ({
    name,
    size: 1,
    ...(webkitRelativePath === undefined ? {} : { webkitRelativePath }),
  });

  test("derives the path from webkitRelativePath", () => {
    const result = fromFileList([f("a.mp3", "Album/Disc/a.mp3"), f("b.wav", "Album/b.wav")]);
    expect(result.files.map((x) => x.path)).toEqual([["Album", "Disc"], ["Album"]]);
  });

  test("plain files have no path and non-audio or hidden ones are dropped", () => {
    const result = fromFileList([f("a.mp3", ""), f("c.jpg", "A/c.jpg"), f("h.mp3", "A/.x/h.mp3")]);
    expect(result.files.map((x) => x.file.name)).toEqual(["a.mp3"]);
    expect(result.files[0]?.path).toEqual([]);
  });

  test("skips files deeper than maxDepth", () => {
    const deep = f("d.mp3", "a/b/c/d.mp3");
    const ok = f("k.mp3", "a/b/k.mp3");
    const result = fromFileList([deep, ok], { maxDepth: 2 });
    expect(result.files.map((x) => x.file.name)).toEqual(["k.mp3"]);
    expect(fromFileList([f("n.mp3", "1/2/3/4/5/6/7/8/n.mp3")]).files).toHaveLength(1);
    expect(fromFileList([f("n.mp3", "1/2/3/4/5/6/7/8/9/n.mp3")]).files).toHaveLength(0);
  });

  test("flags too many files", () => {
    const files = Array.from({ length: 3 }, (_, i) => f(`${i}.mp3`, `A/${i}.mp3`));
    expect(fromFileList(files, { maxFiles: 2 })).toEqual({ files: [], tooMany: true });
  });
});
