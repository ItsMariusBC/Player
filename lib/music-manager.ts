// lib/music-manager.ts
// Audio engine: owns the <audio> element, the AudioContext and the queue.
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
  const audio = new Audio();

  // The real context is created lazily on the first user gesture (autoplay policy).
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let audioSource: MediaElementAudioSourceNode | null = null;

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
        audioSource = context.createMediaElementSource(audio);
        audioSource.connect(analyser);
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
      events.emit({ type: "time", currentTime: 0, duration: 0 });
    },
    onSongListUpdated: (songs) => {
      // A refresh may move the current track without changing it.
      lastIndex = queueManager.currentIndex;
      events.emit({ type: "queue", songs });
    },
  });

  const onPlay = () => {
    pendingPlay = false;
    events.emit({ type: "play", song: queueManager.getCurrentSong() });
  };
  const onPause = () => {
    // The pause fired right before "ended" is a transition, not a user action.
    if (audio.ended) return;
    events.emit({ type: "pause", song: queueManager.getCurrentSong() });
  };
  const onTimeUpdate = () =>
    events.emit({ type: "time", currentTime: audio.currentTime, duration: audio.duration || 0 });
  const onEnded = () => {
    queueManager.next();
    void manager.play();
  };

  const manager: MusicManager = {
    queueManager,
    get analyser() {
      return analyser || tempAnalyser;
    },
    subscribe: events.subscribe,
    getTime: () => audio.currentTime,
    getDuration: () => audio.duration || 0,
    setTime(time) {
      audio.currentTime = Math.max(0, Math.min(time, audio.duration || time));
    },
    isPaused() {
      if (pendingPlay) return false;
      return !context || context.state === "suspended" || audio.paused;
    },
    getVolume: () => audio.volume,
    setVolume(v) {
      audio.volume = Math.max(0, Math.min(1, v));
    },
    async play() {
      pendingPlay = true;
      await initAudioContext();
      try {
        if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          await audio.play();
          return;
        }
        await new Promise<void>((resolve) => {
          const onCanPlay = async () => {
            audio.removeEventListener("canplay", onCanPlay);
            try {
              await audio.play();
            } catch (error) {
              pendingPlay = false;
              console.error("Error during delayed play:", error);
            }
            resolve();
          };
          audio.addEventListener("canplay", onCanPlay);
        });
      } catch (error) {
        pendingPlay = false;
        console.error("Error playing audio:", error);
      }
    },
    pause() {
      pendingPlay = false;
      audio.pause();
    },
    setPlaying(song) {
      const wasPlaying = !this.isPaused();
      audio.src = song.url;
      audio.load();
      if (wasPlaying) void this.play();
    },
    clearSource() {
      this.pause();
      audio.removeAttribute("src");
      audio.load();
    },
    destroy() {
      this.pause();
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      events.clear();
      if (context && context.state !== "closed") void context.close();
      if (tempContext.state !== "closed") void tempContext.close();
    },
  };

  audio.addEventListener("timeupdate", onTimeUpdate);
  audio.addEventListener("play", onPlay);
  audio.addEventListener("pause", onPause);
  audio.addEventListener("ended", onEnded);
  // The queue starts empty: the player feeds it with the catalogue (setSongs).

  return manager;
}
