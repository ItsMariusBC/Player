// components/song-notification.tsx
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MusicManager } from "@/lib/music-manager";
import { QueueItem } from "@/lib/queue-manager";

export function SongNotificationProvider({
  musicManager,
  children
}: {
  musicManager: MusicManager;
  children: React.ReactNode;
}) {
  const [notifications, setNotifications] = useState<{
    id: number;
    song: QueueItem;
    type: "play" | "pause" | "next" | "previous";
  }[]>([]);

  // S'abonner aux événements du lecteur de musique
  useEffect(() => {
    let lastSongId: number | null = null;
    
    const handleStateChange = () => {
      const currentSong = musicManager.queueManager.getCurrentSong();
      if (!currentSong) return;
      
      // Créer une notification lorsque l'état de lecture change
      if (musicManager.isPaused()) {
        addNotification(currentSong, "pause");
      } else {
        // Seulement afficher "play" si c'est la même chanson que précédemment
        if (lastSongId === currentSong.id) {
          addNotification(currentSong, "play");
        }
      }
      
      lastSongId = currentSong.id;
    };
    
    const handleSongChange = (song?: QueueItem) => {
      if (!song) return;
      
      // Déterminer si c'est une chanson suivante ou précédente
      if (lastSongId !== null) {
        if (song.id > lastSongId) {
          addNotification(song, "next");
        } else if (song.id < lastSongId) {
          addNotification(song, "previous");
        } else {
          // Première chanson, afficher "play"
          addNotification(song, "play");
        }
      } else {
        // Première chanson, afficher "play"
        addNotification(song, "play");
      }
      
      lastSongId = song.id;
    };
    
    // Installer les écouteurs d'événements
    const originalStateChange = musicManager.onStateChange;
    
    // Sauvegarde du callback original de QueueManager.onUpdate
    const originalQueueUpdate = musicManager.queueManager.onUpdate;
    
    // Remplacer les callbacks
    musicManager.onStateChange = () => {
      handleStateChange();
      if (originalStateChange) originalStateChange();
    };
    
    musicManager.queueManager.onUpdate = (song) => {
      if (song) handleSongChange(song);
      if (originalQueueUpdate) originalQueueUpdate(song);
    };
    
    return () => {
      // Restaurer les callbacks originaux
      musicManager.onStateChange = originalStateChange;
      musicManager.queueManager.onUpdate = originalQueueUpdate;
    };
  }, [musicManager]);
  
  // Ajouter une nouvelle notification
  const addNotification = (song: QueueItem, type: "play" | "pause" | "next" | "previous") => {
    const id = Date.now();
    
    setNotifications(prev => [...prev, { id, song, type }]);
    
    // Supprimer la notification après 3 secondes
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3000);
  };
  
  return (
    <>
      {children}
      
      {/* Conteneur de notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {notifications.map(({ id, song, type }) => (
            <SongNotification key={id} song={song} type={type} />
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}

function SongNotification({ 
  song, 
  type 
}: { 
  song: QueueItem; 
  type: "play" | "pause" | "next" | "previous" 
}) {
  // Déterminer l'icône à afficher
  const getIcon = () => {
    switch (type) {
      case "play":
        return (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        );
      case "pause":
        return (
          <svg
            width="20"
            height="20"
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
        );
      case "next":
        return (
          <svg
            width="20"
            height="20"
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
        );
      case "previous":
        return (
          <svg
            width="20"
            height="20"
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
        );
    }
  };
  
  // Déterminer le message à afficher
  const getMessage = () => {
    switch (type) {
      case "play":
        return "Lecture en cours";
      case "pause":
        return "Lecture en pause";
      case "next":
        return "Chanson suivante";
      case "previous":
        return "Chanson précédente";
    }
  };
  
  return (
    <motion.div
      className="bg-purple-800/80 backdrop-blur-md text-purple-100 rounded-lg p-3 shadow-lg flex items-center gap-3 max-w-xs pointer-events-auto"
      initial={{ x: 100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 100, opacity: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
    >
      {/* Image de la chanson */}
      {song.picture ? (
        <img
          src={song.picture}
          alt={song.name}
          className="w-12 h-12 rounded object-cover"
        />
      ) : (
        <div className="w-12 h-12 bg-purple-400/20 rounded flex items-center justify-center">
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
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
      )}
      
      <div className="flex-1">
        <div className="text-sm font-medium">{song.name}</div>
        <div className="text-xs text-purple-200">{song.author}</div>
        <div className="flex items-center gap-1 mt-1 text-xs text-purple-300">
          {getIcon()}
          <span>{getMessage()}</span>
        </div>
      </div>
    </motion.div>
  );
}