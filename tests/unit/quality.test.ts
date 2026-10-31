import { describe, expect, test } from "bun:test";
import {
  nextQualitySetting,
  parseQualitySetting,
  qualityLabel,
  resolveQuality,
  type QualityEnv,
} from "../../lib/quality";

const env = (over: Partial<QualityEnv> = {}): QualityEnv => ({
  saveData: false,
  effectiveType: "4g",
  coarsePointer: false,
  viewportWidth: 1280,
  ...over,
});

describe("parseQualitySetting", () => {
  test("accepts the three values", () => {
    expect(parseQualitySetting("auto")).toBe("auto");
    expect(parseQualitySetting("max")).toBe("max");
    expect(parseQualitySetting("light")).toBe("light");
  });
  test("falls back to auto", () => {
    for (const raw of [null, undefined, "", "LIGHT", "low", 1, {}, []]) {
      expect(parseQualitySetting(raw)).toBe("auto");
    }
  });
});

describe("resolveQuality", () => {
  test("max and light ignore the environment", () => {
    expect(resolveQuality("max", env({ saveData: true }))).toBe("max");
    expect(resolveQuality("light", env())).toBe("light");
  });
  test("auto: good conditions give max", () => {
    expect(resolveQuality("auto", env())).toBe("max");
    expect(resolveQuality("auto", env({ effectiveType: null }))).toBe("max");
  });
  test("auto: saveData gives light", () => {
    expect(resolveQuality("auto", env({ saveData: true }))).toBe("light");
  });
  test("auto: slow connections give light", () => {
    for (const effectiveType of ["slow-2g", "2g", "3g"]) {
      expect(resolveQuality("auto", env({ effectiveType }))).toBe("light");
    }
  });
  test("auto: coarse pointer on a narrow viewport gives light", () => {
    expect(resolveQuality("auto", env({ coarsePointer: true, viewportWidth: 768 }))).toBe("light");
    expect(resolveQuality("auto", env({ coarsePointer: true, viewportWidth: 390 }))).toBe("light");
  });
  test("auto: coarse pointer on a wide viewport, or narrow with a fine pointer, gives max", () => {
    expect(resolveQuality("auto", env({ coarsePointer: true, viewportWidth: 769 }))).toBe("max");
    expect(resolveQuality("auto", env({ coarsePointer: false, viewportWidth: 500 }))).toBe("max");
  });
});

describe("nextQualitySetting and qualityLabel", () => {
  test("cycles auto, max, light, auto", () => {
    expect(nextQualitySetting("auto")).toBe("max");
    expect(nextQualitySetting("max")).toBe("light");
    expect(nextQualitySetting("light")).toBe("auto");
  });
  test("labels", () => {
    expect(qualityLabel("auto")).toBe("Auto");
    expect(qualityLabel("max")).toBe("Max");
    expect(qualityLabel("light")).toBe("Allégée");
  });
});
