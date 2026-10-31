// lib/media-session.ts
// Exposes playback to the OS / browser through the Media Session API.
import type { Song } from "@/lib/catalog";
import type { MusicManager } from "@/lib/music-manager";
import type { PlaybackController } from "@/lib/playback-controller";

export interface MediaMetadataInitLike {
  title: string;
  artist: string;
  album: string;
  artwork: { src: string }[];
}

export function mediaMetadataInit(song: Song): MediaMetadataInitLike {
  return {
    title: song.name,
    artist: song.author,
    album: song.album,
    artwork: song.picture ? [{ src: song.picture }] : [],
  };
}

/** Whether a position update is due: at most one per `interval` ms. */
export function shouldUpdatePosition(last: number | null, now: number, interval = 1000): boolean {
  return last === null || now - last >= interval;
}

export interface MediaSessionLike {
  metadata: unknown;
  playbackState: string;
  setActionHandler(action: string, handler: ((details: MediaSessionActionDetailsLike) => void) | null): void;
  setPositionState(state?: { duration: number; position: number; playbackRate: number }): void;
}

export interface MediaSessionActionDetailsLike {
  seekTime?: number | null;
  seekOffset?: number | null;
}

export interface BindMediaSessionOptions {
  music: Pick<MusicManager, "subscribe">;
  playback: Pick<PlaybackController, "play" | "pause" | "previous" | "next" | "seek" | "seekBy">;
  mediaSession?: MediaSessionLike | null;
  metadataCtor?: (init: MediaMetadataInitLike) => unknown;
  now?: () => number;
}

const ACTIONS = ["play", "pause", "previoustrack", "nexttrack", "seekto", "seekbackward", "seekforward"];

export function bindMediaSession(options: BindMediaSessionOptions): () => void {
  const { music, playback } = options;
  const session: MediaSessionLike | null =
    options.mediaSession !== undefined
      ? options.mediaSession
      : typeof navigator !== "undefined" && "mediaSession" in navigator
        ? (navigator.mediaSession as unknown as MediaSessionLike)
        : null;
  if (!session) return () => {};

  const now = options.now ?? Date.now;
  const makeMetadata =
    options.metadataCtor ??
    (typeof MediaMetadata !== "undefined"
      ? (init: MediaMetadataInitLike) => new MediaMetadata(init)
      : null);

  const setMetadata = (song: Song | undefined) => {
    if (!song || !makeMetadata) return;
    try {
      session.metadata = makeMetadata(mediaMetadataInit(song));
    } catch {
      // Metadata is best effort.
    }
  };

  const handlers: Record<string, (details: MediaSessionActionDetailsLike) => void> = {
    play: () => void playback.play(),
    pause: () => playback.pause(),
    previoustrack: () => playback.previous(),
    nexttrack: () => playback.next(),
    seekto: (d) => {
      if (typeof d.seekTime === "number") playback.seek(d.seekTime);
    },
    seekbackward: (d) => playback.seekBy(-(d.seekOffset ?? 5)),
    seekforward: (d) => playback.seekBy(d.seekOffset ?? 5),
  };
  for (const action of ACTIONS) {
    try {
      session.setActionHandler(action, handlers[action]);
    } catch {
      // Some browsers reject unsupported actions.
    }
  }

  let lastPosition: number | null = null;
  let metadataSet = false;

  const unsubscribe = music.subscribe((event) => {
    switch (event.type) {
      case "track":
        setMetadata(event.song);
        metadataSet = true;
        lastPosition = null;
        break;
      case "play":
        if (!metadataSet) {
          setMetadata(event.song);
          metadataSet = true;
        }
        session.playbackState = "playing";
        break;
      case "pause":
        session.playbackState = "paused";
        break;
      case "time": {
        const t = now();
        if (!shouldUpdatePosition(lastPosition, t)) break;
        lastPosition = t;
        try {
          if (Number.isFinite(event.duration) && event.duration > 0) {
            session.setPositionState({
              duration: event.duration,
              position: Math.min(Math.max(event.currentTime, 0), event.duration),
              playbackRate: 1,
            });
          } else {
            session.setPositionState();
          }
        } catch {
          // Invalid state is ignored.
        }
        break;
      }
    }
  });

  return () => {
    unsubscribe();
    for (const action of ACTIONS) {
      try {
        session.setActionHandler(action, null);
      } catch {
        // ignore
      }
    }
    try {
      session.metadata = null;
    } catch {
      // ignore
    }
  };
}
