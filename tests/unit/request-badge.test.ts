import { describe, expect, test } from "bun:test";
import {
  REQUESTS_SEEN_KEY,
  markSeen,
  readSeenAt,
  unseenRequestChanges,
} from "../../lib/request-badge";

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
    expect(readSeenAt(storage)).toBeNull();
    markSeen(storage, Date.UTC(2026, 9, 27, 12));
    expect(storage.data.get(REQUESTS_SEEN_KEY)).toBe("2026-10-27T12:00:00.000Z");
    expect(readSeenAt(storage)).toBe("2026-10-27T12:00:00.000Z");
  });
  test("ignores garbage and survives throwing or missing storage", () => {
    const storage = memory();
    storage.data.set(REQUESTS_SEEN_KEY, "nope");
    expect(readSeenAt(storage)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSeenAt(broken)).toBeNull();
    expect(() => markSeen(broken, 0)).not.toThrow();
    expect(readSeenAt(null)).toBeNull();
    expect(() => markSeen(null, 0)).not.toThrow();
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
