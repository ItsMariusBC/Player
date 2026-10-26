// components/progress-bar.tsx
// Bare progress bar pinned to the top edge. Grows on hover, darkens up to the
// pointer to show where a click would seek, click seeks.
import { useRef, useState, type PointerEvent, type MouseEvent } from "react";
import { MusicManager } from "@/lib/music-manager";
import { PlaybackController } from "@/lib/playback-controller";
import { usePlaybackState } from "@/lib/hooks/use-playback-state";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function ProgressBar({ music, playback }: { music: MusicManager; playback: PlaybackController }) {
  const { currentTime, duration } = usePlaybackState(music);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const progress = duration > 0 ? clamp01(currentTime / duration) : 0;

  const ratioAt = (event: PointerEvent | MouseEvent) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp01((event.clientX - rect.left) / rect.width);
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Progression de la lecture"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      className="group fixed inset-x-0 top-0 z-40 flex h-4 cursor-pointer items-start"
      onPointerMove={(event) => setHoverRatio(ratioAt(event))}
      onPointerLeave={() => setHoverRatio(null)}
      onClick={(event) => playback.seekRatio(ratioAt(event))}
    >
      <div className="relative h-[3px] w-full overflow-hidden bg-purple-100/15 transition-[height] duration-200 ease-out group-hover:h-2">
        <div
          className="absolute inset-y-0 left-0 bg-purple-400 transition-[width] duration-200 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
        {hoverRatio !== null && (
          <div
            className="absolute inset-y-0 left-0 bg-black/35"
            style={{ width: `${hoverRatio * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}
