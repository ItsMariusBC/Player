// lib/music-manager.ts
// Audio engine: owns two <audio> elements (current + standby for the next track),
// the AudioContext and the queue.
// It emits PlayerEvents; it never knows about the UI.
import type { Song } from "@/lib/catalog";
import {
  createQueueManager,
  getTrackDirection,
  QueueItem,
  QueueManager,
  TrackDirection,
} from "@/lib/queue-manager";
import { createEmitter, Listener } from "@/lib/events";
import { nextToPreload } from "@/lib/preload";

export type PlayerEvent =
  | { type: "play"; song: QueueItem | undefined }
  | { type: "pause"; song: QueueItem | undefined }
  | { type: "track"; song: QueueItem; direction: TrackDirection }
  | { type: "time"; currentTime: number; duration: number }
  | { type: "queue"; songs: QueueItem[] };

export type PlayerEventListener = Listener<PlayerEvent>;

export interface MusicManager {
  readonly queueManager: QueueManager;
  readonly analyser: AnalyserNode;

  /** Subscribes to playback events. Returns the unsubscribe function. */
  subscribe(listener: PlayerEventListener): () => void;

  play(): Promise<void>;
  pause(): void;
  setPlaying(song: Song): void;
  /** Stops and detaches the media, e.g. when the queue becomes empty. */
  clearSource(): void;
  destroy(): void;

  isPaused(): boolean;
  getTime(): number;
  getDuration(): number;
  setTime(time: number): void;

  getVolume(): number;
  setVolume(v: number): void;
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor {
  return window.AudioContext || (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext;
}

export function createMusicManager(): MusicManager {
  const events = createEmitter<PlayerEvent>();
  const makeAudio = () => {
    const el = new Audio();
    el.preload = "auto";
    return el;
  };
  // `current` plays; `standby` preloads the next track and takes over on a swap.
  let current = makeAudio();
  let standby = makeAudio();
  // song.url loaded in `standby`, or null when it holds nothing.
  let standbyUrl: string | null = null;
  // Preloading is allowed once the current track is buffered (or after 5 s of play).
  let preloadArmed = false;
  let preloadTimer: ReturnType<typeof setTimeout> | null = null;
  // setTime before metadata: applied on loadedmetadata of `current`.
  let pendingSeek: number | null = null;
  let volume = 1;

  // The real context is created lazily on the first user gesture (autoplay policy).
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  const sources: MediaElementAudioSourceNode[] = [];

  // Placeholder analyser so the visualizer can mount before any interaction.
  const Ctor = getAudioContextCtor();
  const tempContext = new Ctor();
  const tempAnalyser = tempContext.createAnalyser();
  void tempContext.suspend();

  const initAudioContext = async () => {
    if (!context) {
      try {
        context = new Ctor();
        analyser = context.createAnalyser();
        for (const el of [current, standby]) {
          const source = context.createMediaElementSource(el);
          source.connect(analyser);
          sources.push(source);
        }
        analyser.connect(context.destination);
      } catch (error) {
        console.error("Error initializing AudioContext:", error);
      }
    } else if (context.state === "suspended") {
      try {
        await context.resume();
      } catch (error) {
        console.error("Error resuming AudioContext:", error);
      }
    }
  };

  const emptyElement = (el: HTMLAudioElement) => {
    el.pause();
    el.removeAttribute("src");
    el.load();
  };

  const clearPreloadTimer = () => {
    if (preloadTimer !== null) {
      clearTimeout(preloadTimer);
      preloadTimer = null;
    }
  };

  // Loads the track after the current one into `standby`, unless already loaded.
  const preloadNext = () => {
    const next = nextToPreload(queueManager.songs, queueManager.currentIndex);
    if (!next) {
      if (standbyUrl !== null) {
        emptyElement(standby);
        standbyUrl = null;
      }
      return;
    }
    if (standbyUrl === next.url) return;
    standby.src = next.url;
    standby.preload = "auto";
    standby.load();
    standbyUrl = next.url;
  };

  const armPreload = () => {
    preloadArmed = true;
    clearPreloadTimer();
    preloadNext();
  };

  let lastIndex = -1;
  let lastSongId: string | undefined;
  // True between a play() request and the "play" event, so a track change
  // while playing never reads as paused during the source swap.
  let pendingPlay = false;

  const queueManager = createQueueManager({
    onUpdate: (song) => {
      if (song) manager.setPlaying(song);
      else manager.clearSource();
      const nextIndex = queueManager.currentIndex;
      if (song && lastSongId !== undefined && song.id !== lastSongId) {
        events.emit({
          type: "track",
          song,
          direction: getTrackDirection(lastIndex, nextIndex, queueManager.songs.length),
        });
      }
      lastIndex = nextIndex;
      lastSongId = song?.id;
      if (preloadArmed) preloadNext();
      events.emit({ type: "time", currentTime: 0, duration: 0 });
    },
    onSongListUpdated: (songs) => {
      // A refresh may move the current track without changing it.
      lastIndex = queueManager.currentIndex;
      events.emit({ type: "queue", songs });
      if (preloadArmed) preloadNext();
    },
  });

  const onPlay = (event: Event) => {
    if (event.currentTarget !== current) return;
    pendingPlay = false;
    if (!preloadArmed && preloadTimer === null) preloadTimer = setTimeout(armPreload, 5000);
    events.emit({ type: "play", song: queueManager.getCurrentSong() });
  };
  const onPause = (event: Event) => {
    if (event.currentTarget !== current) return;
    // The pause fired right before "ended" is a transition, not a user action.
    if (current.ended) return;
    events.emit({ type: "pause", song: queueManager.getCurrentSong() });
  };
  const onTimeUpdate = (event: Event) => {
    if (event.currentTarget !== current) return;
    events.emit({ type: "time", currentTime: current.currentTime, duration: current.duration || 0 });
  };
  const onLoadedMetadata = (event: Event) => {
    if (event.currentTarget !== current) return;
    if (pendingSeek === null) return;
    const time = pendingSeek;
    pendingSeek = null;
    current.currentTime = Math.max(0, Math.min(time, current.duration || time));
  };
  const onCanPlayThrough = (event: Event) => {
    if (event.currentTarget !== current) return;
    armPreload();
  };
  const onEnded = (event: Event) => {
    if (event.currentTarget !== current) return;
    queueManager.next();
    void manager.play();
  };

  const manager: MusicManager = {
    queueManager,
    get analyser() {
      return analyser || tempAnalyser;
    },
    subscribe: events.subscribe,
    getTime: () => current.currentTime,
    getDuration: () => current.duration || 0,
    setTime(time) {
      if (current.readyState === HTMLMediaElement.HAVE_NOTHING) {
        pendingSeek = time;
        return;
      }
      current.currentTime = Math.max(0, Math.min(time, current.duration || time));
    },
    isPaused() {
      if (pendingPlay) return false;
      return !context || context.state === "suspended" || current.paused;
    },
    getVolume: () => volume,
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      current.volume = volume;
      standby.volume = volume;
    },
    async play() {
      pendingPlay = true;
      await initAudioContext();
      try {
        const el = current;
        if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          await el.play();
          return;
        }
        await new Promise<void>((resolve) => {
          const onCanPlay = async () => {
            el.removeEventListener("canplay", onCanPlay);
            try {
              await el.play();
            } catch (error) {
              pendingPlay = false;
              console.error("Error during delayed play:", error);
            }
            resolve();
          };
          el.addEventListener("canplay", onCanPlay);
        });
      } catch (error) {
        pendingPlay = false;
        console.error("Error playing audio:", error);
      }
    },
    pause() {
      pendingPlay = false;
      current.pause();
    },
    setPlaying(song) {
      const wasPlaying = !this.isPaused();
      pendingSeek = null;
      preloadArmed = false;
      clearPreloadTimer();
      if (standbyUrl === song.url) {
        // The track is already buffered in standby: swap roles.
        const previous = current;
        current = standby;
        standby = previous;
        standbyUrl = null;
        emptyElement(standby);
        if (current.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) armPreload();
      } else {
        current.src = song.url;
        current.load();
      }
      if (wasPlaying) void this.play();
    },
    clearSource() {
      this.pause();
      pendingSeek = null;
      preloadArmed = false;
      clearPreloadTimer();
      emptyElement(current);
      emptyElement(standby);
      standbyUrl = null;
    },
    destroy() {
      this.pause();
      clearPreloadTimer();
      for (const el of [current, standby]) {
        el.removeEventListener("play", onPlay);
        el.removeEventListener("pause", onPause);
        el.removeEventListener("timeupdate", onTimeUpdate);
        el.removeEventListener("ended", onEnded);
        el.removeEventListener("loadedmetadata", onLoadedMetadata);
        el.removeEventListener("canplaythrough", onCanPlayThrough);
      }
      events.clear();
      if (context && context.state !== "closed") void context.close();
      if (tempContext.state !== "closed") void tempContext.close();
    },
  };

  for (const el of [current, standby]) {
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("canplaythrough", onCanPlayThrough);
  }
  // The queue starts empty: the player feeds it with the catalogue (setSongs).

  return manager;
}
