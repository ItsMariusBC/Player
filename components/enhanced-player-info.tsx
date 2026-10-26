// components/enhanced-player-info.tsx
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MusicManager } from "@/lib/music-manager";
import { formatSeconds } from "@/lib/format";
import { QueueItem } from "@/lib/queue-manager";
import { AnimatedCover } from "./animated-cover";
import { cn } from "@/lib/cn";

export function EnhancedPlayerInfo({ 
  musicManager 
}: { 
  musicManager: MusicManager 
}) {
  const [currentSong, setCurrentSong] = useState<QueueItem | undefined>(
    musicManager?.queueManager.getCurrentSong()
  );
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(!musicManager?.isPaused());
  
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
  
  // Obtenir la prochaine chanson pour afficher une prévisualisation
  const nextSong = musicManager.queueManager.songs[
    (musicManager.queueManager.currentIndex + 1) % musicManager.queueManager.songs.length
  ];
  
  if (!currentSong) {
    return (
      <div className="flex flex-col items-center p-6 text-center">
        <p className="text-xl font-light">Aucune chanson en lecture</p>
        <p className="text-sm text-purple-200 mt-2">Ajoutez des chansons ou importez votre musique</p>
      </div>
    );
  }
  
  return (
    <div className="relative flex flex-col md:flex-row gap-8 p-4 md:p-6 rounded-xl bg-purple-800/10 backdrop-blur-sm">
      {/* Badge statut de lecture */}
      <div className="absolute top-3 right-3 px-2 py-1 rounded-full text-xs font-medium bg-purple-500/20">
        {isPlaying ? "En lecture" : "En pause"}
      </div>
      
      {/* Pochette animée */}
      <div className="flex items-center justify-center">
        <AnimatePresence mode="wait">
          <AnimatedCover key={currentSong.id} song={currentSong} />
        </AnimatePresence>
      </div>
      
      {/* Informations de la chanson */}
      <div className="flex-1 flex flex-col justify-between">
        <div>
          <motion.h2 
            className="text-2xl font-medium mb-1 line-clamp-2"
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {currentSong.name}
          </motion.h2>
          
          <motion.p 
            className="text-sm text-purple-200"
            initial={{ y: -5, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            {currentSong.author}
          </motion.p>
        </div>
        
        {/* Barre de progression */}
        <div className="mt-4 mb-2">
          <div className="h-1 bg-purple-200/10 rounded-full overflow-hidden">
            <motion.div 
              className="h-full bg-purple-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          
          <div className="flex justify-between text-xs text-purple-200 mt-1">
            <span>{formatSeconds(currentTime)}</span>
            <span>{formatSeconds(duration)}</span>
          </div>
        </div>
        
        {/* Contrôles de lecture */}
        <div className="flex justify-between items-center mt-2">
          <button 
            className="p-2 rounded-full hover:bg-purple-200/10 transition-colors"
            onClick={() => musicManager.queueManager.previous()}
          >
            <svg
              width="24"
              height="24"
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
            className={cn(
              "p-4 rounded-full bg-purple-500/20 hover:bg-purple-500/30 transition-all",
              isPlaying ? "scale-100" : "scale-110"
            )}
            onClick={() => isPlaying ? musicManager.pause() : musicManager.play()}
          >
            {isPlaying ? (
              <svg
                width="24"
                height="24"
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
                width="24"
                height="24"
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
          
          <button 
            className="p-2 rounded-full hover:bg-purple-200/10 transition-colors"
            onClick={() => musicManager.queueManager.next()}
          >
            <svg
              width="24"
              height="24"
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
      </div>
      
      {/* Prochaine chanson */}
      {nextSong && (
        <div className="mt-4 pt-4 border-t border-purple-200/10">
          <div className="flex items-center gap-3">
            <div className="text-xs text-purple-200">À suivre:</div>
            <div className="flex items-center gap-2">
              {nextSong.picture ? (
                <img 
                  src={nextSong.picture} 
                  alt={nextSong.name} 
                  className="w-8 h-8 rounded object-cover"
                />
              ) : (
                <div className="w-8 h-8 bg-purple-400/10 rounded flex items-center justify-center">
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
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                </div>
              )}
              <div>
                <div className="text-sm font-medium">{nextSong.name}</div>
                <div className="text-xs text-purple-200">{nextSong.author}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}