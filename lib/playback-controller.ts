// lib/playback-controller.ts
// Single entry point for every playback action triggered by the UI or the
// keyboard. Components never talk to the engine directly for actions.
import { MusicManager } from "@/lib/music-manager";
import { QueueItem } from "@/lib/queue-manager";

export interface PlaybackController {
  play(): Promise<void>;
  pause(): void;
  toggle(): void;
  /** Pauses and rewinds to the start of the track. */
  stop(): void;

  next(): void;
  previous(): void;
  /** Jumps to a song of the queue (by item or absolute index) and plays it. */
  playSong(target: QueueItem | number): void;

  seek(seconds: number): void;
  seekBy(deltaSeconds: number): void;
  /** Seeks to a position expressed as a 0..1 ratio of the duration. */
  seekRatio(ratio: number): void;

  setVolume(volume: number): void;
  isPlaying(): boolean;
}

export function createPlaybackController(music: MusicManager): PlaybackController {
  const { queueManager } = music;

  return {
    play: () => music.play(),
    pause: () => music.pause(),
    toggle() {
      if (music.isPaused()) void music.play();
      else music.pause();
    },
    stop() {
      music.pause();
      music.setTime(0);
    },
    next: () => queueManager.next(),
    previous: () => queueManager.previous(),
    playSong(target) {
      const index =
        typeof target === "number"
          ? target
          : queueManager.songs.findIndex((song) => song.id === target.id);
      if (index === -1) return;
      const wasPaused = music.isPaused();
      queueManager.setIndex(index);
      if (wasPaused) void music.play();
    },
    seek: (seconds) => music.setTime(seconds),
    seekBy: (delta) => music.setTime(music.getTime() + delta),
    seekRatio(ratio) {
      const clamped = Math.max(0, Math.min(1, ratio));
      music.setTime(clamped * music.getDuration());
    },
    setVolume: (volume) => music.setVolume(volume),
    isPlaying: () => !music.isPaused(),
  };
}
