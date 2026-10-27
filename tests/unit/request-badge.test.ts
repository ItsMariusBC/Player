import { describe, expect, test } from "bun:test";
import { markSeen, readSeenAt, seenKey, unseenRequestChanges } from "../../lib/request-badge";

const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};

const req = (status: "pending" | "accepted" | "added" | "rejected", updatedAt: string) => ({
  status,
  updatedAt,
});

describe("seen storage", () => {
  test("round-trips an ISO date under the versioned key", () => {
    const storage = memory();
    expect(readSeenAt("u1", storage)).toBeNull();
    markSeen("u1", storage, Date.UTC(2026, 9, 27, 12));
    expect(seenKey("u1")).toBe("player.requests.seen.v1:u1");
    expect(storage.data.get("player.requests.seen.v1:u1")).toBe("2026-10-27T12:00:00.000Z");
    expect(readSeenAt("u1", storage)).toBe("2026-10-27T12:00:00.000Z");
  });
  test("keeps one date per user", () => {
    const storage = memory();
    markSeen("u1", storage, Date.UTC(2026, 9, 27, 12));
    expect(readSeenAt("u2", storage)).toBeNull();
    markSeen("u2", storage, Date.UTC(2026, 9, 27, 13));
    expect(readSeenAt("u1", storage)).toBe("2026-10-27T12:00:00.000Z");
    expect(readSeenAt("u2", storage)).toBe("2026-10-27T13:00:00.000Z");
  });
  test("ignores garbage and survives throwing or missing storage", () => {
    const storage = memory();
    storage.data.set(seenKey("u1"), "nope");
    expect(readSeenAt("u1", storage)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSeenAt("u1", broken)).toBeNull();
    expect(() => markSeen("u1", broken, 0)).not.toThrow();
    expect(readSeenAt("u1", null)).toBeNull();
    expect(() => markSeen("u1", null, 0)).not.toThrow();
  });
});

describe("unseenRequestChanges", () => {
  const list = [
    req("pending", "2026-10-27T10:00:00.000Z"),
    req("accepted", "2026-10-27T09:00:00.000Z"),
    req("added", "2026-10-27T11:00:00.000Z"),
    req("rejected", "2026-10-27T12:00:00.000Z"),
  ];
  test("counts every non-pending request when never seen", () => {
    expect(unseenRequestChanges(list, null)).toBe(3);
  });
  test("counts only non-pending changes after the last opening", () => {
    expect(unseenRequestChanges(list, "2026-10-27T10:30:00.000Z")).toBe(2);
    expect(unseenRequestChanges(list, "2026-10-27T12:00:00.000Z")).toBe(0);
  });
  test("pending requests never count", () => {
    expect(unseenRequestChanges([req("pending", "2030-01-01T00:00:00.000Z")], null)).toBe(0);
  });
  test("empty list", () => {
    expect(unseenRequestChanges([], null)).toBe(0);
  });
});
