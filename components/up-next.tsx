// components/up-next.tsx
// Bottom-right hint: cover + "À suivre : <title>" for the next track of the queue.
import { AnimatePresence, m } from "framer-motion";
import { MusicManager } from "@/lib/music-manager";
import { usePlaybackState } from "@/lib/hooks/use-playback-state";
import { TRACK_TRANSITION } from "@/lib/transitions";

export function UpNext({ music }: { music: MusicManager }) {
  const { songs } = usePlaybackState(music);
  const nextSong =
    songs.length > 1 ? songs[(music.queueManager.currentIndex + 1) % songs.length] : undefined;

  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-30 max-w-[min(640px,calc(100vw-1.5rem))] md:right-4 md:bottom-4">
      <AnimatePresence mode="wait" initial={false}>
        {nextSong && (
          <m.div
            key={nextSong.id}
            className="flex items-center gap-3 text-purple-50 drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]"
            initial={{ opacity: 0, y: 8 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: {
                delay: TRACK_TRANSITION.playerDelay / 1000,
                duration: TRACK_TRANSITION.playerDuration / 1000,
                ease: "easeOut",
              },
            }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.15 } }}
          >
            {nextSong.picture ? (
              <img
                src={nextSong.picture}
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
              <span className="text-purple-200/70">À suivre : </span>
              <span className="font-medium">{nextSong.name}</span>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
