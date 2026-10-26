// lib/shortcut-manager.ts
// Keyboard bindings. Only active when nothing focusable has the focus, so a
// focused button keeps its native Space/Enter behaviour.
import { PlaybackController } from "@/lib/playback-controller";

export interface ShortcutManagerOptions {
  playback: PlaybackController;
  onToggleMiniPlayer?: () => void;
  seekStep?: number;
}

export interface ShortcutManager {
  bind(): void;
  destroy(): void;
}

export function createShortcutManager({
  playback,
  onToggleMiniPlayer,
  seekStep = 5,
}: ShortcutManagerOptions): ShortcutManager {
  const actions: Record<string, () => void> = {
    Space: () => playback.toggle(),
    ArrowUp: () => playback.previous(),
    ArrowDown: () => playback.next(),
    ArrowLeft: () => playback.seekBy(-seekStep),
    ArrowRight: () => playback.seekBy(seekStep),
    KeyM: () => onToggleMiniPlayer?.(),
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && target !== document.body && target !== document.documentElement) return;

    const action = actions[event.code];
    if (!action) return;
    action();
    event.preventDefault();
  };

  return {
    bind() {
      window.addEventListener("keydown", onKeyDown);
    },
    destroy() {
      window.removeEventListener("keydown", onKeyDown);
    },
  };
}
