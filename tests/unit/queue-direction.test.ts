import { describe, expect, test } from "bun:test";
import { getTrackDirection } from "../../lib/queue-manager";

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
