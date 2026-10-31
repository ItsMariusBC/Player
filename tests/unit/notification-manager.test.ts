import { describe, expect, test } from "bun:test";
import { createNotificationManager, Notification } from "../../lib/notification-manager";
import type { PlayerEvent, PlayerEventListener } from "../../lib/music-manager";
import type { QueueItem } from "../../lib/queue-manager";

const song = (n: number): QueueItem => ({
  id: `song-${n}`,
  name: `Song ${n}`,
  author: "A",
  album: "",
  url: `/api/media/song-${n}`,
  folderId: null,
  folderPath: [],
  updatedAt: "2026-10-27T00:00:00.000Z",
  gainDb: 0,
});

function setup() {
  let listener: PlayerEventListener = () => {};
  let clock = 0;
  const timers: { fn: () => void; at: number; cleared: boolean }[] = [];
  const seen: (Notification | null)[] = [];

  const manager = createNotificationManager(
    {
      subscribe: (l) => {
        listener = l;
        return () => {};
      },
    },
    {
      duration: 1000,
      trackDelay: 300,
      transitionWindow: 500,
      now: () => clock,
      setTimer: (fn, ms) => {
        timers.push({ fn, at: clock + ms, cleared: false });
        return timers.length - 1;
      },
      clearTimer: (id) => {
        if (typeof id === "number" && timers[id]) timers[id].cleared = true;
      },
    },
  );
  manager.subscribe((n) => seen.push(n));

  const advance = (ms: number) => {
    clock += ms;
    for (const t of timers) {
      if (t.cleared || t.at > clock) continue;
      t.cleared = true;
      t.fn();
    }
  };
  const emit = (event: PlayerEvent) => listener(event);
  return { manager, seen, emit, advance };
}

describe("notification manager", () => {
  test("a skip produces a single notification despite the pause/play transition", () => {
    const { seen, emit, advance } = setup();
    emit({ type: "track", song: song(2), direction: "next" });
    emit({ type: "pause", song: song(2) });
    advance(50);
    emit({ type: "play", song: song(2) });
    advance(300);

    expect(seen.map((n) => n && n.kind)).toEqual(["next"]);
  });

  test("the track notification waits for the choreography delay", () => {
    const { manager, emit, advance } = setup();
    emit({ type: "track", song: song(2), direction: "next" });
    advance(299);
    expect(manager.getCurrent()).toBeNull();
    advance(1);
    expect(manager.getCurrent()?.kind).toBe("next");
  });

  test("two quick skips only notify the last track", () => {
    const { seen, emit, advance } = setup();
    emit({ type: "track", song: song(2), direction: "next" });
    advance(100);
    emit({ type: "track", song: song(3), direction: "next" });
    advance(300);
    expect(seen.map((n) => n && n.song.id)).toEqual(["song-3"]);
  });

  test("a new notification replaces the current one instead of stacking", () => {
    const { manager, seen, emit, advance } = setup();
    emit({ type: "track", song: song(2), direction: "next" });
    advance(900);
    emit({ type: "pause", song: song(2) });

    expect(seen.map((n) => n && n.kind)).toEqual(["next", "pause"]);
    expect(manager.getCurrent()?.kind).toBe("pause");
  });

  test("notifications expire after the configured duration", () => {
    const { manager, seen, emit, advance } = setup();
    emit({ type: "play", song: song(1) });
    advance(999);
    expect(manager.getCurrent()?.kind).toBe("play");
    advance(1);
    expect(manager.getCurrent()).toBeNull();
    expect(seen.at(-1)).toBeNull();
  });

  test("a late play after a track change is still the resume, not a notification", () => {
    const { seen, emit, advance } = setup();
    emit({ type: "track", song: song(2), direction: "next" });
    advance(2000);
    emit({ type: "play", song: song(2) });
    expect(seen.filter(Boolean).map((n) => n && n.kind)).toEqual(["next"]);
  });

  test("a play after a user pause is reported", () => {
    const { seen, emit, advance } = setup();
    emit({ type: "track", song: song(2), direction: "next" });
    advance(900);
    emit({ type: "pause", song: song(2) });
    advance(100);
    emit({ type: "play", song: song(2) });
    expect(seen.map((n) => n && n.kind)).toEqual(["next", "pause", "play"]);
  });

  test("play/pause after the transition window are reported", () => {
    const { seen, emit, advance } = setup();
    emit({ type: "track", song: song(3), direction: "previous" });
    advance(800);
    emit({ type: "pause", song: song(3) });
    expect(seen.map((n) => n && n.kind)).toEqual(["previous", "pause"]);
  });
});
