// lib/player-runtime.ts
// Composition root: wires the audio engine, the playback controller, the
// notification policy and the keyboard shortcuts together.
import { createMusicManager, MusicManager } from "@/lib/music-manager";
import { createPlaybackController, PlaybackController } from "@/lib/playback-controller";
import { createNotificationManager, NotificationManager } from "@/lib/notification-manager";
import { createShortcutManager, ShortcutManager } from "@/lib/shortcut-manager";

export interface PlayerRuntime {
  music: MusicManager;
  playback: PlaybackController;
  notifications: NotificationManager;
  shortcuts: ShortcutManager;
  destroy(): void;
}

export interface PlayerRuntimeOptions {
  onToggleMiniPlayer?: () => void;
}

export function createPlayerRuntime(options: PlayerRuntimeOptions = {}): PlayerRuntime {
  const music = createMusicManager();
  const playback = createPlaybackController(music);
  const notifications = createNotificationManager(music);
  const shortcuts = createShortcutManager({
    playback,
    onToggleMiniPlayer: options.onToggleMiniPlayer,
  });
  shortcuts.bind();

  return {
    music,
    playback,
    notifications,
    shortcuts,
    destroy() {
      shortcuts.destroy();
      notifications.destroy();
      music.destroy();
    },
  };
}
