// components/mini-player.tsx
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MusicManager } from "@/lib/music-manager";
import { QueueItem } from "@/lib/queue-manager";
import { formatSeconds } from "@/lib/format";
import { cn } from "@/lib/cn";

export function MiniPlayer({ 
  musicManager, 
  isVisible = true
}: { 
  musicManager: MusicManager;
  isVisible?: boolean;
}) {
  const [currentSong, setCurrentSong] = useState<QueueItem | undefined>(
    musicManager?.queueManager.getCurrentSong()
  );
  const [isPlaying, setIsPlaying] = useState(!musicManager?.isPaused());
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Mettre à jour l'état lorsque la chanson ou l'état de lecture change
  useEffect(() => {
    const handleUpdate = () => {
      setCurrentSong(musicManager.queueManager.getCurrentSong());
      setIsPlaying(!musicManager.isPaused());
    };
    
    const handleTimeUpdate = (time: number, totalDuration: number) => {
      setCurrentTime(time);
      setDuration(totalDuration);
    };
    
    // Sauvegarde des callbacks originaux
    const originalOnStateChange = musicManager.onStateChange;
    const originalOnTimeUpdate = musicManager.onTimeUpdate;
    
    // Configuration des nouveaux callbacks
    musicManager.onStateChange = () => {
      handleUpdate();
      if (originalOnStateChange) originalOnStateChange();
    };
    
    musicManager.onTimeUpdate = (time: number, totalDuration: number) => {
      handleTimeUpdate(time, totalDuration);
      if (originalOnTimeUpdate) originalOnTimeUpdate(time, totalDuration);
    };
    
    // État initial
    handleUpdate();
    
    return () => {
      // Restauration des callbacks originaux
      musicManager.onStateChange = originalOnStateChange;
      musicManager.onTimeUpdate = originalOnTimeUpdate;
    };
  }, [musicManager]);
  
  // Calculer le pourcentage de progression
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  
  if (!currentSong || !isVisible) {
    return null;
  }
  
  return (
    <motion.div
      className="fixed bottom-4 right-4 z-50 shadow-xl"
      drag
      dragConstraints={{ top: 0, right: 0, bottom: 0, left: 0 }}
      dragMomentum={false}
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <motion.div
        className={cn(
          "bg-purple-800/80 backdrop-blur-md text-purple-100 rounded-xl overflow-hidden",
          isExpanded ? "w-72" : "w-56"
        )}
        layout
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      >
        {/* Barre de progression */}
        <div className="h-1 bg-purple-200/10 w-full">
          <motion.div 
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
                  className="w-10 h-10 rounded object-cover"
                />
              ) : (
                <div className="w-10 h-10 bg-purple-400/20 rounded flex items-center justify-center">
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
              <motion.div
                className="absolute -top-1 -right-1 w-4 h-4 bg-purple-500 rounded-full flex items-center justify-center text-white text-xs"
                animate={{ rotate: isExpanded ? 180 : 0 }}
              >
                {isExpanded ? "-" : "+"}
              </motion.div>
            </div>
            
            {/* Informations sur la chanson */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{currentSong.name}</div>
              <div className="text-xs text-purple-200 truncate">{currentSong.author}</div>
            </div>
            
            {/* Bouton lecture/pause */}
            <button
              className="p-2 rounded-full hover:bg-purple-200/10 transition-colors"
              onClick={() => isPlaying ? musicManager.pause() : musicManager.play()}
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
              <motion.div
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
                    onClick={() => musicManager.queueManager.previous()}
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
                    onClick={() => musicManager.setTime(Math.max(0, currentTime - 10))}
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
                    onClick={() => musicManager.setTime(Math.min(duration, currentTime + 10))}
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
                    onClick={() => musicManager.queueManager.next()}
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}