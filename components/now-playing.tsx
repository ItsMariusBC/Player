// components/now-playing.tsx
// Top-left hint: cover + "En lecture : <title>" (or "En pause") for the current track.
import { AnimatePresence, m } from "framer-motion";
import { MusicManager } from "@/lib/music-manager";
import { usePlaybackState } from "@/lib/hooks/use-playback-state";
import { TRACK_TRANSITION } from "@/lib/transitions";

export function NowPlaying({ music }: { music: MusicManager }) {
  const { currentSong, isPlaying } = usePlaybackState(music);

  return (
    <div className="pointer-events-none fixed top-4 left-3 z-30 max-w-[min(640px,calc(100vw-1.5rem))] md:top-5 md:left-4">
      <AnimatePresence mode="wait" initial={false}>
        {currentSong && (
          <m.div
            key={currentSong.id}
            className="flex items-center gap-3 text-purple-50 drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]"
            initial={{ opacity: 0, y: -8 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: {
                delay: TRACK_TRANSITION.playerDelay / 1000,
                duration: TRACK_TRANSITION.playerDuration / 1000,
                ease: "easeOut",
              },
            }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
          >
            {currentSong.picture ? (
              <img
                src={currentSong.picture}
                alt=""
                width={36}
                height={36}
                decoding="async"
                className="size-9 shrink-0 rounded-md object-cover shadow-lg ring-1 ring-purple-100/15"
              />
            ) : (
              <div className="size-9 shrink-0 rounded-md bg-purple-200/10 ring-1 ring-purple-100/15" />
            )}
            <div className="min-w-0 truncate text-sm whitespace-nowrap">
              <span className="text-purple-200/70">{isPlaying ? "En lecture" : "En pause"} : </span>
              <span className="font-medium">{currentSong.name}</span>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
