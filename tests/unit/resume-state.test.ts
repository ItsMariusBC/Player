import { describe, expect, test } from "bun:test";
import {
  bindResumeSaver,
  parseResumeState,
  RESUME_KEY,
  resumeTarget,
  type ResumeState,
} from "../../lib/resume-state";
import type { PlayerEvent } from "../../lib/music-manager";

const DAY = 24 * 60 * 60 * 1000;
const songs = [{ id: "a" }, { id: "b" }, { id: "c" }];
const state = (over: Partial<ResumeState> = {}): ResumeState => ({
  trackId: "b",
  position: 42,
  updatedAt: 1_000_000,
  ...over,
});

describe("parseResumeState", () => {
  test("accepts a valid state", () => {
    expect(parseResumeState(JSON.stringify(state()))).toEqual(state());
    expect(parseResumeState(JSON.stringify(state({ position: 12.5 })))?.position).toBe(12.5);
  });

  test.each([
    ["null", null],
    ["empty", ""],
    ["broken JSON", "{nope"],
    ["not an object", "42"],
    ["null JSON", "null"],
    ["missing trackId", JSON.stringify({ position: 1, updatedAt: 1 })],
    ["empty trackId", JSON.stringify({ trackId: "", position: 1, updatedAt: 1 })],
    ["string position", JSON.stringify({ trackId: "a", position: "1", updatedAt: 1 })],
    ["negative position", JSON.stringify({ trackId: "a", position: -1, updatedAt: 1 })],
    ["missing updatedAt", JSON.stringify({ trackId: "a", position: 1 })],
  ])("rejects %s", (_name, raw) => {
    expect(parseResumeState(raw)).toBeNull();
  });
});

describe("resumeTarget", () => {
  const now = 1_000_000 + DAY;

  test("finds the track and position", () => {
    expect(resumeTarget(songs, state(), now)).toEqual({ index: 1, position: 42 });
  });
  test("returns null without state", () => {
    expect(resumeTarget(songs, null, now)).toBeNull();
  });
  test("returns null when the track left the catalogue", () => {
    expect(resumeTarget(songs, state({ trackId: "gone" }), now)).toBeNull();
  });
  test("returns null when the state is older than 30 days", () => {
    expect(resumeTarget(songs, state(), 1_000_000 + 31 * DAY)).toBeNull();
    expect(resumeTarget(songs, state(), 1_000_000 + 30 * DAY)).not.toBeNull();
  });
  test("brings positions under 5 s back to 0", () => {
    expect(resumeTarget(songs, state({ position: 4.9 }), now)?.position).toBe(0);
    expect(resumeTarget(songs, state({ position: 5 }), now)?.position).toBe(5);
  });
});

function setup() {
  let listener: ((event: PlayerEvent) => void) | undefined;
  let time = 0;
  let clock = 10_000;
  let currentId: string | undefined = "a";
  const store = new Map<string, string>();
  const pageListeners = new Map<string, () => void>();
  let removed = 0;
  const music = {
    subscribe(l: (event: PlayerEvent) => void) {
      listener = l;
      return () => {
        listener = undefined;
      };
    },
    getTime: () => time,
    queueManager: { getCurrentSong: () => (currentId ? ({ id: currentId } as never) : undefined) },
  };
  const detach = bindResumeSaver(music, {
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
    },
    now: () => clock,
    pageTarget: {
      addEventListener: (type: string, fn: unknown) =>
        void pageListeners.set(type, fn as () => void),
      removeEventListener: () => void removed++,
    },
  });
  const saved = () => parseResumeState(store.get(RESUME_KEY) ?? null);
  return {
    detach,
    saved,
    pageListeners,
    removed: () => removed,
    emit: (e: PlayerEvent) => listener?.(e),
    hasListener: () => listener !== undefined,
    setTime: (t: number) => (time = t),
    advance: (ms: number) => (clock += ms),
    setCurrent: (id: string | undefined) => (currentId = id),
  };
}

const timeEvent = (currentTime: number): PlayerEvent => ({
  type: "time",
  currentTime,
  duration: 100,
});

describe("bindResumeSaver", () => {
  test("throttles time saves to once per 2 s", () => {
    const s = setup();
    s.emit(timeEvent(10));
    expect(s.saved()).toEqual({ trackId: "a", position: 10, updatedAt: 10_000 });
    s.advance(1000);
    s.emit(timeEvent(11));
    expect(s.saved()?.position).toBe(10);
    s.advance(1000);
    s.emit(timeEvent(12));
    expect(s.saved()).toEqual({ trackId: "a", position: 12, updatedAt: 12_000 });
  });

  test("saves on pause with the current time", () => {
    const s = setup();
    s.setTime(33);
    s.emit({ type: "pause", song: undefined });
    expect(s.saved()?.position).toBe(33);
  });

  test("saves position 0 for the new track", () => {
    const s = setup();
    s.emit({ type: "track", song: { id: "c" } as never, direction: "next" });
    expect(s.saved()).toMatchObject({ trackId: "c", position: 0 });
  });

  test("saves on pagehide", () => {
    const s = setup();
    s.setTime(77);
    s.pageListeners.get("pagehide")?.();
    expect(s.saved()).toMatchObject({ trackId: "a", position: 77 });
  });

  test("does not save without a current song", () => {
    const s = setup();
    s.setCurrent(undefined);
    s.emit({ type: "pause", song: undefined });
    expect(s.saved()).toBeNull();
  });

  test("never throws when storage fails and detaches", () => {
    let clock = 0;
    const detach = bindResumeSaver(
      {
        subscribe: () => () => {},
        getTime: () => 1,
        queueManager: { getCurrentSong: () => ({ id: "a" }) as never },
      },
      {
        storage: {
          getItem: () => {
            throw new Error("blocked");
          },
          setItem: () => {
            throw new Error("blocked");
          },
        },
        now: () => clock++,
        pageTarget: null,
      },
    );
    expect(() => detach()).not.toThrow();
    const s = setup();
    s.detach();
    expect(s.hasListener()).toBe(false);
    expect(s.removed()).toBe(1);
  });
});
