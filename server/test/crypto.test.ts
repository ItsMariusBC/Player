import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { hashSessionId, newSessionId, open, seal } from "../src/crypto.ts";

const key = randomBytes(32);

describe("seal and open", () => {
  it("round-trips a value", () => {
    assert.equal(open(seal("secret value", key), key), "secret value");
  });

  it("returns null when the sealed text is altered", () => {
    const sealed = seal("secret value", key);
    const last = sealed.length - 1;
    const swapped = sealed[last] === "A" ? "B" : "A";
    assert.equal(open(sealed.slice(0, last) + swapped, key), null);
  });

  it("returns null with another key", () => {
    assert.equal(open(seal("secret value", key), randomBytes(32)), null);
  });

  it("returns null on malformed input", () => {
    assert.equal(open("not-sealed", key), null);
    assert.equal(open("", key), null);
  });

  it("produces different output for the same plaintext", () => {
    assert.notEqual(seal("same", key), seal("same", key));
  });
});

describe("session ids", () => {
  it("generates 43 character unique ids", () => {
    const first = newSessionId();
    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(first, newSessionId());
  });

  it("hashes to a stable 64 character hex digest", () => {
    const id = newSessionId();
    assert.match(hashSessionId(id), /^[0-9a-f]{64}$/);
    assert.equal(hashSessionId(id), hashSessionId(id));
  });
});
