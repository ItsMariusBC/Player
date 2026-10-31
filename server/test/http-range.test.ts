import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRange } from "../src/http-range.ts";

describe("parseRange", () => {
  it("returns null without a usable header", () => {
    assert.equal(parseRange(undefined, 1000), null);
    assert.equal(parseRange("", 1000), null);
    assert.equal(parseRange("items=0-5", 1000), null);
    assert.equal(parseRange("bytes=abc", 1000), null);
    assert.equal(parseRange("bytes=-", 1000), null);
  });
  it("parses open and closed ranges", () => {
    assert.deepEqual(parseRange("bytes=0-", 1000), { start: 0, end: 999 });
    assert.deepEqual(parseRange("bytes=100-199", 1000), { start: 100, end: 199 });
  });
  it("clamps end to the last byte", () => {
    assert.deepEqual(parseRange("bytes=900-5000", 1000), { start: 900, end: 999 });
  });
  it("parses suffix ranges", () => {
    assert.deepEqual(parseRange("bytes=-500", 1000), { start: 500, end: 999 });
    assert.deepEqual(parseRange("bytes=-5000", 1000), { start: 0, end: 999 });
  });
  it("flags unsatisfiable ranges", () => {
    assert.equal(parseRange("bytes=5-2", 1000), "unsatisfiable");
    assert.equal(parseRange("bytes=1000-", 1000), "unsatisfiable");
    assert.equal(parseRange("bytes=-0", 1000), "unsatisfiable");
    assert.equal(parseRange("bytes=0-", 0), "unsatisfiable");
  });
  it("keeps the first range only", () => {
    assert.deepEqual(parseRange("bytes=0-9, 20-29", 1000), { start: 0, end: 9 });
  });
});
