// components/player.tsx
import { CornerActions } from "@/components/corner-actions";
import { AdminPanel } from "@/components/admin/admin-panel";
import { useSessionInfo } from "@/components/auth-gate";
import { useCallback, useEffect, useRef, useState, MouseEventHandler } from "react";
import { Gradient } from "@/components/gradient";
import { createPlayerRuntime, PlayerRuntime } from "@/lib/player-runtime";
import { useSongGradient } from "@/lib/hooks/use-song-gradient";
import { useCatalog } from "@/lib/hooks/use-catalog";
import { type Catalog, flattenCatalog } from "@/lib/catalog";
import { bindResumeSaver, readResumeState, resumeTarget } from "@/lib/resume-state";
import { VisualizerCard, VisualizerStage } from "@/components/visualizer-panel";
import { AnimatePresence, LazyMotion, MotionConfig, m } from "framer-motion";

const loadMotionFeatures = () => import("@/lib/motion-features").then((mod) => mod.default);
import { NowPlaying } from "@/components/now-playing";
import { SongList } from "@/components/song-list";
import { SongRequestDialog } from "@/components/song-request-dialog";
import { MiniPlayer } from "@/components/mini-player";
import { UpNext } from "@/components/up-next";
import { ProgressBar } from "@/components/progress-bar";
import { SongNotificationProvider } from "@/components/song-notification";
import { cn } from "@/lib/cn";
import { buttonVariants } from "@/components/ui/button";

export default function MusicPlayer() {
  const [runtime, setRuntime] = useState<PlayerRuntime>();
  const musicManager = runtime?.music;
  // État pour l'overlay d'interaction audio
  const [audioEnabled, setAudioEnabled] = useState(false);
  // trigger re-renders
  const [, setDigit] = useState(0);
  const [showMiniPlayer, setShowMiniPlayer] = useState(false);
  // Expanded visualizer: the rest of the UI is unmounted, only the shader stays.
  const [visualizerExpanded, setVisualizerExpanded] = useState(false);
  const closeVisualizer = useCallback(() => setVisualizerExpanded(false), []);
  // Admin panel: unmounts the rest of the UI the same way.
  const { role } = useSessionInfo();
  const [adminOpen, setAdminOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const closeAdmin = useCallback(() => setAdminOpen(false), []);
  const closeRequest = useCallback(() => setRequestOpen(false), []);
  const focusMode = visualizerExpanded || adminOpen;
  // Server catalogue. `queued` is the catalogue currently loaded in the queue:
  // the player renders only once the first one is in, so no empty-queue flash.
  const { status: catalogStatus, catalog, error: catalogError, refresh: refreshCatalog } = useCatalog();
  const [queued, setQueued] = useState<Catalog>();

  // The « Administration » button is unmounted while the panel is open: once it is back,
  // give it the focus (looked up by attribute, never through a ref to the old node).
  const adminWasOpen = useRef(false);
  useEffect(() => {
    if (adminOpen) {
      adminWasOpen.current = true;
      return;
    }
    if (!adminWasOpen.current) return;
    adminWasOpen.current = false;
    document.querySelector<HTMLElement>("[data-admin-button]")?.focus();
  }, [adminOpen]);

  // Same for « Demander un son », unmounted while its stage is open.
  const requestWasOpen = useRef(false);
  useEffect(() => {
    if (requestOpen) {
      requestWasOpen.current = true;
      return;
    }
    if (!requestWasOpen.current) return;
    requestWasOpen.current = false;
    document.querySelector<HTMLElement>("[data-request-button]")?.focus();
  }, [requestOpen]);

  const paused = musicManager?.isPaused() ?? true;
  const currentSong = musicManager?.queueManager.getCurrentSong();
  const gradient = useSongGradient(currentSong);

  const restoredRef = useRef(false);
  const unbindResumeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const player = createPlayerRuntime({
      onToggleMiniPlayer: () => setShowMiniPlayer((prev) => !prev),
    });
    // Any engine event other than time progress may change what is rendered.
    const unsubscribe = player.music.subscribe((event) => {
      if (event.type !== "time") setDigit((prev) => prev + 1);
    });
    setRuntime(player);

    return () => {
      unbindResumeRef.current?.();
      unbindResumeRef.current = null;
      restoredRef.current = false;
      unsubscribe();
      player.destroy();
    };
  }, []);

  // Every new catalogue (first load, poll, refresh) replaces the queue; the
  // queue keeps the current track by id (see QueueManager.setSongs).
  useEffect(() => {
    if (!runtime || !catalog) return;
    const { music } = runtime;
    const songs = flattenCatalog(catalog);
    music.queueManager.setSongs(songs);
    if (!restoredRef.current) {
      restoredRef.current = true;
      // Restore before binding the saver so the restore itself is not saved
      // back as position 0. Never autoplay: the activation overlay stays.
      const target = resumeTarget(songs, readResumeState(), Date.now());
      if (target) {
        music.queueManager.setIndex(target.index);
        if (target.position > 0) music.setTime(target.position);
      }
      unbindResumeRef.current = bindResumeSaver(music);
    }
    setQueued(catalog);
  }, [runtime, catalog]);


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
    if (!runtime || e.button !== 0) return;

    const target = e.target as Element;
    const isTrigger = target.matches(
      "[data-trigger-container] *, [data-trigger-container], [data-trigger]",
    );

    if (!isTrigger) return;
    runtime.playback.toggle();
  };

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

  if (!queued && catalogStatus === "error") {
    return (
      <main className="flex min-h-svh items-center justify-center px-6 text-purple-100">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Catalogue indisponible</h1>
          <p className="mt-3 text-sm text-purple-300/70">{catalogError}</p>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "ghost" }), "mt-6")}
            onClick={() => void refreshCatalog()}
          >
            Réessayer
          </button>
        </div>
      </main>
    );
  }

  if (!runtime || !queued) {
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
    <LazyMotion features={loadMotionFeatures} strict>
    <MotionConfig reducedMotion="user">
      <SongNotificationProvider notifications={runtime.notifications}>
        <m.main
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            ease: "easeInOut",
            duration: 0.5,
          }}
          className="relative min-h-svh flex items-center px-6 py-8 z-2 text-purple-100 md:p-12"
          onMouseDown={onClick}
        >
          {adminOpen ? (
            <AdminPanel onClose={closeAdmin} onCatalogChanged={refreshCatalog} />
          ) : visualizerExpanded ? (
            <VisualizerStage analyser={runtime.music.analyser} onClose={closeVisualizer} />
          ) : (
          <div className="w-full max-w-6xl mx-auto">
            {requestOpen ? (
              <SongRequestDialog onClose={closeRequest} />
            ) : (
            <div className="grid md:grid-cols-12 gap-8">
              <div className="md:col-span-8">
                <div>
                  <VisualizerCard
                    analyser={runtime.music.analyser}
                    onExpand={() => setVisualizerExpanded(true)}
                  />
                </div>
              </div>
              
              <div className="md:col-span-4">
                <div className="flex flex-col bg-purple-800/10 backdrop-blur-xs p-4 rounded-lg md:h-[500px] max-h-[500px]">
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <SongList music={runtime.music} playback={runtime.playback} folders={queued.folders} />
                  </div>
                  <button
                    type="button"
                    data-request-button=""
                    className={cn(buttonVariants({ variant: "ghost" }), "shrink-0 w-full mt-3")}
                    onClick={() => setRequestOpen(true)}
                  >
                    Demander un son
                  </button>
                </div>
              </div>
            </div>
            )}
          </div>
          )}
          
          <m.div
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
            <Gradient colors={gradient} />
          </m.div>
          
          {!focusMode && (
            <>
              <NowPlaying music={runtime.music} />
              <UpNext music={runtime.music} />
              <CornerActions isAdmin={role === "admin"} onOpenAdmin={() => setAdminOpen(true)} />
            </>
          )}
          <ProgressBar music={runtime.music} playback={runtime.playback} />

          {/* Mini-player */}
          <AnimatePresence>
            {showMiniPlayer && !focusMode && (
              <MiniPlayer music={runtime.music} playback={runtime.playback} />
            )}
          </AnimatePresence>
          
          {/* Overlay pour demander l'activation audio */}
          <AnimatePresence>
            {!audioEnabled && (
              <m.div 
                className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <m.div 
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
                </m.div>
              </m.div>
            )}
          </AnimatePresence>
        </m.main>
      </SongNotificationProvider>
    </MotionConfig>
    </LazyMotion>
  );
}
