import { describe, expect, test } from "bun:test";
import { hexToRgb, interpolateGradient, rgbToHex } from "../../lib/palette";

describe("palette", () => {
  test("hex round trip", () => {
    expect(rgbToHex(hexToRgb("#8d7dca"))).toBe("#8d7dca");
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
  });

  test("interpolateGradient blends each stop and clamps t", () => {
    const from = ["#000000", "#000000", "#000000"] as const;
    const to = ["#ffffff", "#ff0000", "#0000ff"] as const;
    expect(interpolateGradient([...from], [...to], 0)).toEqual([...from]);
    expect(interpolateGradient([...from], [...to], 1)).toEqual([...to]);
    expect(interpolateGradient([...from], [...to], 0.5)).toEqual(["#808080", "#800000", "#000080"]);
    expect(interpolateGradient([...from], [...to], 2)).toEqual([...to]);
  });
});
