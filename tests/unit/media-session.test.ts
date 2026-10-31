import { describe, expect, test } from "bun:test";
import {
  bindMediaSession,
  mediaMetadataInit,
  shouldUpdatePosition,
  type MediaSessionLike,
} from "../../lib/media-session";
import type { PlayerEvent, PlayerEventListener } from "../../lib/music-manager";
import type { Song } from "../../lib/catalog";

const song = (picture?: string): Song => ({
  id: "a",
  name: "Title",
  author: "Artist",
  album: "Album",
  url: "/api/media/a",
  picture,
  folderId: null,
  folderPath: [],
  updatedAt: "2026-01-01",
  gainDb: 0,
});

function setup() {
  let listener: PlayerEventListener = () => {};
  let clock = 0;
  const positions: unknown[] = [];
  const handlers = new Map<string, unknown>();
  const calls: string[] = [];
  const session: MediaSessionLike = {
    metadata: null,
    playbackState: "none",
    setActionHandler(action, handler) {
      if (action === "seekto") throw new Error("unsupported");
      handlers.set(action, handler);
    },
    setPositionState(state) {
      positions.push(state);
    },
  };
  const detach = bindMediaSession({
    music: {
      subscribe: (l) => {
        listener = l;
        return () => {};
      },
    },
    playback: {
      play: async () => void calls.push("play"),
      pause: () => void calls.push("pause"),
      previous: () => void calls.push("previous"),
      next: () => void calls.push("next"),
      seek: (s) => void calls.push(`seek:${s}`),
      seekBy: (d) => void calls.push(`seekBy:${d}`),
    },
    mediaSession: session,
    metadataCtor: (init) => init,
    now: () => clock,
  });
  const emit = (e: PlayerEvent) => listener(e);
  return { session, emit, positions, handlers, calls, detach, tick: (ms: number) => (clock += ms) };
}

describe("mediaMetadataInit", () => {
  test("maps song fields and artwork", () => {
    expect(mediaMetadataInit(song("/c.jpg"))).toEqual({
      title: "Title",
      artist: "Artist",
      album: "Album",
      artwork: [{ src: "/c.jpg" }],
    });
    expect(mediaMetadataInit(song()).artwork).toEqual([]);
  });
});

describe("shouldUpdatePosition", () => {
  test("throttles to one per interval", () => {
    expect(shouldUpdatePosition(null, 0)).toBe(true);
    expect(shouldUpdatePosition(0, 999)).toBe(false);
    expect(shouldUpdatePosition(0, 1000)).toBe(true);
  });
});

describe("bindMediaSession", () => {
  test("does nothing without a media session", () => {
    const detach = bindMediaSession({
      music: { subscribe: () => () => {} },
      playback: {} as never,
      mediaSession: null,
    });
    expect(detach()).toBeUndefined();
  });

  test("sets metadata on track and playback state on play/pause", () => {
    const t = setup();
    t.emit({ type: "track", song: song(), direction: "next" });
    expect((t.session.metadata as { title: string }).title).toBe("Title");
    t.emit({ type: "play", song: song() });
    expect(t.session.playbackState).toBe("playing");
    t.emit({ type: "pause", song: song() });
    expect(t.session.playbackState).toBe("paused");
  });

  test("a failing setActionHandler does not stop the others", () => {
    const t = setup();
    expect(t.handlers.has("seekto")).toBe(false);
    expect(t.handlers.has("nexttrack")).toBe(true);
    (t.handlers.get("seekforward") as (d: object) => void)({});
    (t.handlers.get("seekbackward") as (d: object) => void)({ seekOffset: 10 });
    expect(t.calls).toEqual(["seekBy:5", "seekBy:-10"]);
  });

  test("position state is throttled and reset when duration is unknown", () => {
    const t = setup();
    t.emit({ type: "time", currentTime: 1, duration: 100 });
    t.tick(500);
    t.emit({ type: "time", currentTime: 1.5, duration: 100 });
    t.tick(500);
    t.emit({ type: "time", currentTime: 2, duration: 100 });
    expect(t.positions).toEqual([
      { duration: 100, position: 1, playbackRate: 1 },
      { duration: 100, position: 2, playbackRate: 1 },
    ]);
    t.tick(1000);
    t.emit({ type: "time", currentTime: 0, duration: NaN });
    expect(t.positions[2]).toBeUndefined();
    expect(t.positions.length).toBe(3);
  });

  test("detach clears handlers", () => {
    const t = setup();
    t.detach();
    expect(t.handlers.get("play")).toBeNull();
    expect(t.session.metadata).toBeNull();
  });
});
