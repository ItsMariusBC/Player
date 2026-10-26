// components/mini-player.tsx
import { useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { MusicManager } from "@/lib/music-manager";
import { PlaybackController } from "@/lib/playback-controller";
import { usePlaybackState } from "@/lib/hooks/use-playback-state";
import { formatSeconds } from "@/lib/format";
import { cn } from "@/lib/cn";

export function MiniPlayer({
  music,
  playback,
  isVisible = true,
}: {
  music: MusicManager;
  playback: PlaybackController;
  isVisible?: boolean;
}) {
  const { currentSong, isPlaying, currentTime, duration } = usePlaybackState(music);
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Calculer le pourcentage de progression
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  
  if (!currentSong || !isVisible) {
    return null;
  }
  
  return (
    <m.div
      className="fixed bottom-4 right-4 z-50 shadow-xl"
      drag
      dragConstraints={{ top: 0, right: 0, bottom: 0, left: 0 }}
      dragMomentum={false}
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <m.div
        className={cn(
          "bg-purple-800/80 backdrop-blur-md text-purple-100 rounded-xl overflow-hidden",
          isExpanded ? "w-72" : "w-56"
        )}
        layout
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      >
        {/* Barre de progression */}
        <div className="h-1 bg-purple-200/10 w-full">
          <m.div 
            className="h-full bg-purple-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        
        <div className="p-3">
          <div className="flex items-center gap-3">
            {/* Pochette de l'album */}
            <div
              className="relative cursor-pointer"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {currentSong.picture ? (
                <img
                  src={currentSong.picture}
                  alt={currentSong.name}
                  width={40}
                  height={40}
                  decoding="async"
                  className="w-10 h-10 rounded-sm object-cover"
                />
              ) : (
                <div className="w-10 h-10 bg-purple-400/20 rounded-sm flex items-center justify-center">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                </div>
              )}
              
              {/* Indicateur d'expansion */}
              <m.div
                className="absolute -top-1 -right-1 w-4 h-4 bg-purple-500 rounded-full flex items-center justify-center text-white text-xs"
                animate={{ rotate: isExpanded ? 180 : 0 }}
              >
                {isExpanded ? "-" : "+"}
              </m.div>
            </div>
            
            {/* Informations sur la chanson */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{currentSong.name}</div>
              <div className="text-xs text-purple-200 truncate">{currentSong.author}</div>
            </div>
            
            {/* Bouton lecture/pause */}
            <button
              className="p-2 rounded-full hover:bg-purple-200/10 transition-colors"
              onClick={() => playback.toggle()}
            >
              {isPlaying ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="4" height="16" x="6" y="4" />
                  <rect width="4" height="16" x="14" y="4" />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
            </button>
          </div>
          
          {/* Section étendue */}
          <AnimatePresence>
            {isExpanded && (
              <m.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-3 overflow-hidden"
              >
                {/* Temps de lecture */}
                <div className="flex justify-between text-xs text-purple-200 mb-3">
                  <span>{formatSeconds(currentTime)}</span>
                  <span>{formatSeconds(duration)}</span>
                </div>
                
                {/* Contrôles supplémentaires */}
                <div className="flex justify-between">
                  <button
                    className="p-2 rounded-full hover:bg-purple-200/10 transition-colors"
                    onClick={() => playback.previous()}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m12 19-7-7 7-7" />
                      <path d="m19 19-7-7 7-7" />
                    </svg>
                  </button>
                  
                  <button
                    className="p-2 rounded-full hover:bg-purple-200/10 transition-colors"
                    onClick={() => playback.seekBy(-10)}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M11 17l-5-5 5-5" />
                      <path d="M18 17l-5-5 5-5" />
                    </svg>
                  </button>
                  
                  <button
                    className="p-2 rounded-full hover:bg-purple-200/10 transition-colors"
                    onClick={() => playback.seekBy(10)}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m7 7 5 5-5 5" />
                      <path d="m13 7 5 5-5 5" />
                    </svg>
                  </button>
                  
                  <button
                    className="p-2 rounded-full hover:bg-purple-200/10 transition-colors"
                    onClick={() => playback.next()}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m5 19 7-7-7-7" />
                      <path d="m12 19 7-7-7-7" />
                    </svg>
                  </button>
                </div>
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </m.div>
    </m.div>
  );
}