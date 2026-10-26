// components/player.tsx
import { useEffect, useRef, useState, useMemo, MouseEventHandler } from "react";
import { Gradient } from "@/components/gradient";
import { createMusicManager, MusicManager } from "@/lib/music-manager";
import { createShortcutManager } from "@/lib/shortcut-manager";
import { EnhancedMusicVisualizer } from "@/components/music-visualizer/enhanced-visualizer";
import { formatSeconds } from "@/lib/format";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { Menu } from "@/components/menu";
import { QueueItem } from "@/lib/queue-manager";
import { Timeline, DurationControl } from "@/components/control/timeline";
import { createThemeManager } from "@/lib/theme-manager";
import { EnhancedPlayerInfo } from "@/components/enhanced-player-info";
import { MiniPlayer } from "@/components/mini-player";
import { SongNotificationProvider } from "@/components/song-notification";
import { DarkModeToggle } from "@/components/dark-mode-toggle";
import { cn } from "@/lib/cn";
import { buttonVariants } from "@/components/ui/button";

export default function MusicPlayer() {
  const timelineRef = useRef<DurationControl>();
  const timeLabelRef = useRef<HTMLParagraphElement>(null);

  const [musicManager, setMusicManager] = useState<MusicManager>();
  // État pour l'overlay d'interaction audio
  const [audioEnabled, setAudioEnabled] = useState(false);
  // trigger re-renders
  const [digit, setDigit] = useState(0);
  const [showMiniPlayer, setShowMiniPlayer] = useState(false);

  const paused = musicManager?.isPaused() ?? true;
  const currentSong = musicManager?.queueManager.getCurrentSong();

  // Initialize theme manager
  useEffect(() => {
    createThemeManager();
  }, []);

  useEffect(() => {
    const manager = createMusicManager({
      onTimeUpdate: (currentTime, duration) => {
        if (timeLabelRef.current) {
          timeLabelRef.current.innerText = formatSeconds(currentTime);
        }

        timelineRef.current?.((currentTime / duration) * 100);
      },
      onStateChange: () => {
        setDigit((prev) => prev + 1);
      },
      onNext() {
        setDigit((prev) => prev + 1);
      },
      onSongListUpdated() {
        setDigit((prev) => prev + 1);
      },
    });

    const shortcut = createShortcutManager({ musicManager: manager });

    shortcut.bind();
    setMusicManager(manager);

    return () => {
      shortcut.destroy();
      manager.destroy();
    };
  }, []);

  // Effect pour détecter la première interaction de l'utilisateur
  useEffect(() => {
    const handleUserInteraction = () => {
      setAudioEnabled(true);
    };

    window.addEventListener('click', handleUserInteraction);
    window.addEventListener('keydown', handleUserInteraction);
    window.addEventListener('touchstart', handleUserInteraction);

    return () => {
      window.removeEventListener('click', handleUserInteraction);
      window.removeEventListener('keydown', handleUserInteraction);
      window.removeEventListener('touchstart', handleUserInteraction);
    };
  }, []);

  const onClick: MouseEventHandler = (e) => {
    if (!musicManager || e.button !== 0) return;

    const target = e.target as Element;
    const isTrigger = target.matches(
      "[data-trigger-container] *, [data-trigger-container], [data-trigger]",
    );

    if (!isTrigger) return;

    if (musicManager.isPaused()) musicManager.play();
    else musicManager.pause();
  };

  // Add a key handler for space to pause/play
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && musicManager) {
        if (musicManager.isPaused()) musicManager.play();
        else musicManager.pause();
        e.preventDefault();
      }
      
      // Toggle mini player with M key
      if (e.code === 'KeyM') {
        setShowMiniPlayer(prev => !prev);
        e.preventDefault();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [musicManager]);
  
  // Active le mini-player après 5 secondes de scrolling vers le bas
  useEffect(() => {
    if (!musicManager) return;
    
    const handleScroll = () => {
      const scrollPosition = window.scrollY || document.documentElement.scrollTop;
      
      if (scrollPosition > window.innerHeight / 2) {
        setShowMiniPlayer(true);
      } else {
        setShowMiniPlayer(false);
      }
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [musicManager]);

  if (!musicManager) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500 mx-auto"></div>
          <p className="mt-4 text-purple-200">Chargement du lecteur...</p>
        </div>
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user" features={["domAnimation"]}>
      <SongNotificationProvider musicManager={musicManager}>
        <motion.main
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            ease: "easeInOut",
            duration: 0.5,
          }}
          className="relative min-h-svh px-6 py-8 z-[2] text-purple-100 md:p-12"
          onMouseDown={onClick}
        >
          <div className="max-w-6xl mx-auto">
            <div className="flex justify-between items-start mb-8">
              <AnimatedTitle text={paused ? "Click to Play" : "Sheldon Player"} />
              
              <div className="flex space-x-2">
                <DarkModeToggle />
                {musicManager && <Menu musicManager={musicManager} />}
              </div>
            </div>
            
            <div className="grid md:grid-cols-12 gap-8">
              <div className="md:col-span-8">
                {/* Lecteur amélioré */}
                {musicManager && (
                  <EnhancedPlayerInfo musicManager={musicManager} />
                )}
                
                <div className="mt-8">
                  <h2 className="text-xl font-medium mb-4">Visualiseur</h2>
                  <div className="bg-purple-800/10 backdrop-blur-sm p-4 rounded-lg" data-trigger-container={true}>
                    {musicManager && (
                      <EnhancedMusicVisualizer
                        className="w-full h-48 md:h-64"
                        analyser={musicManager.analyser}
                      />
                    )}
                  </div>
                </div>
              </div>
              
              <div className="md:col-span-4">
                <h2 className="text-xl font-medium mb-4">File d'attente</h2>
                <div className="bg-purple-800/10 backdrop-blur-sm p-4 rounded-lg max-h-[500px] overflow-y-auto">
                  <SongList musicManager={musicManager} />
                </div>
              </div>
            </div>
            
            <div className="mt-8 pt-8 border-t border-purple-200/10 text-center text-sm text-purple-200">
              <p>
                Appuyez sur [M] pour afficher/masquer le mini-player
                <br />
                Utilisez les touches fléchées et espace pour contrôler la lecture
              </p>
            </div>
          </div>
          
          <motion.div
            data-trigger-container={true}
            className="absolute inset-0 z-[-1]"
            animate={{
              opacity: paused ? 0.3 : 1,
            }}
            initial={{
              opacity: 0,
            }}
            transition={{
              ease: "easeInOut",
              duration: 1,
            }}
          >
            <Gradient currentId={currentSong?.id ?? 0} />
          </motion.div>
          
          {/* Mini-player */}
          <AnimatePresence>
            {showMiniPlayer && musicManager && (
              <MiniPlayer musicManager={musicManager} />
            )}
          </AnimatePresence>
          
          {/* Overlay pour demander l'activation audio */}
          <AnimatePresence>
            {!audioEnabled && (
              <motion.div 
                className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div 
                  className="bg-purple-900/90 backdrop-blur-md p-8 rounded-lg text-center max-w-md"
                  initial={{ scale: 0.9, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.9, y: 20 }}
                >
                  <h2 className="text-xl font-medium mb-4">Activer l'audio</h2>
                  <p className="mb-6">
                    Cliquez sur le bouton ci-dessous pour activer l'audio et commencer à utiliser le lecteur musical
                  </p>
                  <button 
                    className={cn(buttonVariants({ variant: "primary" }))}
                    onClick={() => setAudioEnabled(true)}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mr-2"
                    >
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Activer le lecteur
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.main>
      </SongNotificationProvider>
    </MotionConfig>
  );
}

function AnimatedTitle({ text }: { text: string }) {
  const words = useMemo(() => text.split(" "), [text]);
  let index = 0;

  return (
    <h1 className="text-5xl md:text-7xl font-light leading-[0.9] tracking-[-0.05em]">
      {words.map((word, i) => (
        <motion.span key={i} className="inline-block mr-4 break-keep">
          {word.split("").map((c, j) => (
            <motion.span
              key={`${c}-${j}`}
              className="inline-block"
              initial={{ y: 20, opacity: 0 }}
              animate={{
                y: 0,
                opacity: 1,
                transition: {
                  ease: "easeInOut",
                  delay: index++ * 0.04,
                  duration: 0.2,
                },
              }}
            >
              {c}
            </motion.span>
          ))}
        </motion.span>
      ))}
    </h1>
  );
}

// Composant SongList pour la file d'attente
function SongList({ musicManager }: { musicManager: MusicManager }) {
  const currentSong = musicManager.queueManager.getCurrentSong();
  
  return (
    <div className="space-y-2">
      {musicManager.queueManager.songs.map((song) => (
        <div
          key={song.id}
          className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all ${
            song.id === currentSong?.id 
              ? "bg-purple-500/20" 
              : "hover:bg-purple-200/5"
          }`}
          onClick={() => musicManager.queueManager.setIndex(song.id)}
        >
          {song.picture ? (
            <img src={song.picture} alt={song.name} className="w-10 h-10 rounded object-cover" />
          ) : (
            <div className="w-10 h-10 bg-purple-400/10 rounded flex items-center justify-center">
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
          
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{song.name}</div>
            <div className="text-xs text-purple-200 truncate">{song.author}</div>
          </div>
          
          {song.id === currentSong?.id && (
            <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
          )}
        </div>
      ))}
      
      {musicManager.queueManager.songs.length === 0 && (
        <div className="text-center py-8 text-purple-200">
          <p>Aucune chanson dans la file d'attente</p>
          <p className="text-sm mt-2">Ajoutez des chansons via le menu</p>
        </div>
      )}
    </div>
  );
}
