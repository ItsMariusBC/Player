// lib/queue-manager.ts
import type { Song } from "@/lib/catalog";

/** A queue entry is a catalogue song; its position is its index in `songs`. */
export type QueueItem = Song;

export type TrackDirection = "next" | "previous" | "jump";

/**
 * Infers how the queue moved between two indexes, wrap-around included.
 */
export function getTrackDirection(
  previousIndex: number,
  nextIndex: number,
  length: number,
): TrackDirection {
  if (length < 2) return "jump";
  if (nextIndex === (previousIndex + 1) % length) return "next";
  if (nextIndex === (previousIndex - 1 + length) % length) return "previous";
  return "jump";
}

export interface QueueManagerOptions {
  onUpdate?: (song: QueueItem | undefined) => void;
  onSongListUpdated?: (songs: QueueItem[]) => void;
}

export interface QueueManager {
  currentIndex: number;
  songs: QueueItem[];

  // Callback pour notifier des changements de chanson - nécessaire pour les composants UI
  onUpdate?: (song: QueueItem | undefined) => void;

  getPendingSongs(): QueueItem[];
  getCurrentSong(): QueueItem | undefined;
  /** Selects a song by its index in the queue (wraps around). */
  setIndex(index: number): void;
  /** Replaces the queue, e.g. when the catalogue is (re)loaded. */
  setSongs(songs: Song[]): void;

  previous(): void;
  next(): void;
}

export function createQueueManager(options: QueueManagerOptions): QueueManager {
  return {
    currentIndex: -1,
    songs: [],
    // Pour permettre aux composants UI de s'abonner directement
    onUpdate: options.onUpdate,
    setSongs(songs: Song[]) {
      // Refresh policy: the current track is kept by id (its index may move).
      // If it left the catalogue, the queue clamps to the same index, so the
      // track now at that position takes over (the removed media is no longer
      // served anyway). onUpdate only fires when the current track changes, so
      // a periodic refresh never restarts what is playing.
      const previous = this.getCurrentSong();
      this.songs = songs;

      let target: number;
      if (songs.length === 0) target = -1;
      else if (!previous) target = 0;
      else {
        const found = songs.findIndex((song) => song.id === previous.id);
        target = found !== -1 ? found : Math.min(this.currentIndex, songs.length - 1);
      }
      this.currentIndex = target;

      const current = this.getCurrentSong();
      if (current?.id !== previous?.id || current?.url !== previous?.url) {
        this.onUpdate?.(current);
      }
      options.onSongListUpdated?.(this.songs);
    },
    getPendingSongs() {
      return this.songs.slice(this.currentIndex + 1);
    },
    getCurrentSong() {
      return this.songs[this.currentIndex];
    },
    setIndex(index) {
      let target: number;

      if (this.songs.length === 0) target = -1;
      else if (index >= this.songs.length) target = 0;
      else if (index < 0) target = this.songs.length - 1;
      else target = index;

      if (this.currentIndex === target) return;
      this.currentIndex = target;
      this.onUpdate?.(this.getCurrentSong());
    },
    next() {
      this.setIndex(this.currentIndex + 1);
    },
    previous() {
      this.setIndex(this.currentIndex - 1);
    },
  };
}
