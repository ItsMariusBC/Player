import { describe, expect, test } from "bun:test";
import { formatSeconds } from "../../lib/format";

describe("formatSeconds", () => {
  test.each([
    [0, "00:00"],
    [9, "00:09"],
    [59.9, "00:59"],
    [60, "01:00"],
    [125, "02:05"],
    [3600, "60:00"],
  ])("formats %s seconds as %s", (seconds, expected) => {
    const result = formatSeconds(seconds);
    expect(result).toBe(expected);
  });
});
