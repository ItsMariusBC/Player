// lib/resume-state.ts
// Persists the last track and position so a reload resumes where it stopped.
import type { Song } from "@/lib/catalog";
import type { MusicManager } from "@/lib/music-manager";

export const RESUME_KEY = "player.resume.v1";
export const RESUME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const RESUME_MIN_POSITION = 5;
export const RESUME_SAVE_INTERVAL_MS = 2000;

export interface ResumeState {
  trackId: string;
  /** Seconds. */
  position: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

export interface ResumeTarget {
  index: number;
  position: number;
}

export interface ResumeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ResumeSaverDeps {
  storage?: ResumeStorage | null;
  now?: () => number;
  pageTarget?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
}

export function parseResumeState(raw: string | null): ResumeState | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { trackId, position, updatedAt } = value as Record<string, unknown>;
  if (typeof trackId !== "string" || trackId === "") return null;
  if (typeof position !== "number" || !Number.isFinite(position) || position < 0) return null;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
  return { trackId, position, updatedAt };
}

export function resumeTarget(
  songs: readonly Pick<Song, "id">[],
  state: ResumeState | null,
  now: number,
): ResumeTarget | null {
  if (!state) return null;
  if (now - state.updatedAt > RESUME_MAX_AGE_MS) return null;
  const index = songs.findIndex((song) => song.id === state.trackId);
  if (index < 0) return null;
  return { index, position: state.position < RESUME_MIN_POSITION ? 0 : state.position };
}

function defaultStorage(): ResumeStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readResumeState(storage: ResumeStorage | null = defaultStorage()): ResumeState | null {
  if (!storage) return null;
  try {
    return parseResumeState(storage.getItem(RESUME_KEY));
  } catch {
    return null;
  }
}

type SaverMusic = Pick<MusicManager, "subscribe" | "getTime"> & {
  queueManager: Pick<MusicManager["queueManager"], "getCurrentSong">;
};

/** Saves the resume state on time (throttled), pause, track and pagehide. */
export function bindResumeSaver(music: SaverMusic, deps: ResumeSaverDeps = {}): () => void {
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const now = deps.now ?? Date.now;
  const pageTarget =
    deps.pageTarget === undefined
      ? typeof window === "undefined"
        ? null
        : window
      : deps.pageTarget;
  let lastSave = Number.NEGATIVE_INFINITY;

  const save = (trackId: string | undefined, position: number) => {
    if (!storage || !trackId || !Number.isFinite(position)) return;
    const at = now();
    lastSave = at;
    try {
      const state: ResumeState = { trackId, position: Math.max(0, position), updatedAt: at };
      storage.setItem(RESUME_KEY, JSON.stringify(state));
    } catch {
      // Private mode or blocked storage: resuming is best effort.
    }
  };
  const saveCurrent = () => save(music.queueManager.getCurrentSong()?.id, music.getTime());

  const unsubscribe = music.subscribe((event) => {
    if (event.type === "time") {
      if (now() - lastSave >= RESUME_SAVE_INTERVAL_MS) {
        save(music.queueManager.getCurrentSong()?.id, event.currentTime);
      }
    } else if (event.type === "pause") {
      saveCurrent();
    } else if (event.type === "track") {
      save(event.song.id, 0);
    }
  });
  pageTarget?.addEventListener("pagehide", saveCurrent);

  return () => {
    unsubscribe();
    pageTarget?.removeEventListener("pagehide", saveCurrent);
  };
}
