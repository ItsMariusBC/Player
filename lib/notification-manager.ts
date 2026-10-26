// lib/notification-manager.ts
// Turns raw PlayerEvents into at most one user-facing notification at a time.
import { MusicManager, PlayerEvent } from "@/lib/music-manager";
import { QueueItem } from "@/lib/queue-manager";
import { createEmitter } from "@/lib/events";
import { TRACK_TRANSITION } from "@/lib/transitions";

export type NotificationKind = "next" | "previous" | "jump" | "play" | "pause";

export interface Notification {
  id: number;
  song: QueueItem;
  kind: NotificationKind;
}

export interface NotificationManager {
  /** Called with the current notification, or null when it is dismissed. */
  subscribe(listener: (notification: Notification | null) => void): () => void;
  getCurrent(): Notification | null;
  dismiss(): void;
  destroy(): void;
}

export interface NotificationManagerOptions {
  /** How long a notification stays visible, in ms. */
  duration?: number;
  /** Delay before a track-change notification shows, so it lands after the gradient and player animations. */
  trackDelay?: number;
  /**
   * A track change swaps the audio source, which fires pause/play events that
   * are transitions, not user actions. They are ignored during this window (ms).
   */
  transitionWindow?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

/** Longest time a slow media source may take to resume after a track change. */
const SWALLOW_PLAY_WINDOW = 5000;

export function createNotificationManager(
  music: Pick<MusicManager, "subscribe">,
  {
    duration = 2400,
    trackDelay = TRACK_TRANSITION.notificationDelay,
    transitionWindow = 800,
    now = () => performance.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  }: NotificationManagerOptions = {},
): NotificationManager {
  const events = createEmitter<Notification | null>();
  let current: Notification | null = null;
  let timer: unknown;
  let pending: unknown;
  let suppressUntil = 0;
  // The "play" that follows a track change is the source swap resuming, not a
  // user action, however long the media takes to become ready.
  let swallowPlayUntil = 0;
  let nextId = 1;

  const set = (notification: Notification | null) => {
    current = notification;
    events.emit(notification);
  };

  const show = (song: QueueItem, kind: NotificationKind) => {
    clearTimer(timer);
    set({ id: nextId++, song, kind });
    timer = setTimer(() => set(null), duration);
  };

  const onEvent = (event: PlayerEvent) => {
    switch (event.type) {
      case "track": {
        suppressUntil = now() + trackDelay + transitionWindow;
        swallowPlayUntil = now() + SWALLOW_PLAY_WINDOW;
        clearTimer(pending);
        const { song, direction } = event;
        pending = setTimer(() => show(song, direction), trackDelay);
        break;
      }
      case "play":
        if (now() < swallowPlayUntil) {
          swallowPlayUntil = 0;
          return;
        }
        if (!event.song || now() < suppressUntil) return;
        show(event.song, "play");
        break;
      case "pause":
        if (!event.song || now() < suppressUntil) return;
        swallowPlayUntil = 0;
        show(event.song, "pause");
        break;
    }
  };

  const unsubscribe = music.subscribe(onEvent);

  return {
    subscribe: events.subscribe,
    getCurrent: () => current,
    dismiss() {
      clearTimer(pending);
      clearTimer(timer);
      set(null);
    },
    destroy() {
      unsubscribe();
      clearTimer(pending);
      clearTimer(timer);
      events.clear();
    },
  };
}
