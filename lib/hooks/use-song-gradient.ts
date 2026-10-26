// lib/hooks/use-song-gradient.ts
import { useEffect, useState } from "react";
import { Song } from "@/music/data";
import { DEFAULT_GRADIENT, getSongGradient, GradientColors } from "@/lib/palette";

/**
 * Target gradient of the current song. The crossfade between two gradients is
 * done inside the WebGL scene (uniforms), not with React state.
 */
export function useSongGradient(song: Song | undefined): GradientColors {
  const [gradient, setGradient] = useState<GradientColors>(DEFAULT_GRADIENT);

  useEffect(() => {
    let cancelled = false;
    void getSongGradient(song).then((colors) => {
      if (!cancelled) setGradient(colors);
    });
    return () => {
      cancelled = true;
    };
  }, [song?.picture, song?.gradient]);

  return gradient;
}
