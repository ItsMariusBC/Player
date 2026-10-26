// lib/hooks/use-playback-state.ts
import { useEffect, useState } from "react";
import { MusicManager } from "@/lib/music-manager";
import { QueueItem } from "@/lib/queue-manager";

export interface PlaybackState {
  currentSong: QueueItem | undefined;
  songs: QueueItem[];
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

function snapshot(music: MusicManager, currentTime = music.getTime(), duration = music.getDuration()): PlaybackState {
  return {
    currentSong: music.queueManager.getCurrentSong(),
    songs: music.queueManager.songs,
    isPlaying: !music.isPaused(),
    currentTime,
    duration,
  };
}

/**
 * React view of the engine state. Time updates only touch the time fields so
 * song/queue derived renders stay cheap.
 */
export function usePlaybackState(music: MusicManager): PlaybackState {
  const [state, setState] = useState(() => snapshot(music));

  useEffect(() => {
    setState(snapshot(music));
    return music.subscribe((event) => {
      if (event.type === "time") {
        setState((prev) => ({ ...prev, currentTime: event.currentTime, duration: event.duration }));
      } else {
        setState((prev) => snapshot(music, prev.currentTime, prev.duration));
      }
    });
  }, [music]);

  return state;
}
