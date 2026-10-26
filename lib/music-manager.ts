// lib/music-manager.ts
import { Song } from "@/music/data";
import {
  createQueueManager,
  QueueItem,
  QueueManager,
  QueueManagerOptions,
} from "@/lib/queue-manager";
import { createStorageManager, StorageManager } from "@/lib/storage-manager";

export interface MusicManager {
  storageManager: StorageManager;
  queueManager: QueueManager;
  analyser: AnalyserNode;
  
  // Callbacks pour les composants UI
  onStateChange?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;

  play(): void;
  pause(): void;
  setPlaying(song: Song): void;
  destroy(): void;

  isPaused(): boolean;
  getTime(): number;
  getDuration(): number;
  setTime(time: number): void;

  getVolume(): number;
  setVolume(v: number): void;
}

export interface MusicManagerOptions
  extends Omit<QueueManagerOptions, "onUpdate"> {
  onNext?: (song: QueueItem | undefined) => void;
  onStateChange?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
}

export function createMusicManager({
  onSongListUpdated,
  ...options
}: MusicManagerOptions): MusicManager {
  // Créer l'AudioContext mais ne pas connecter les nœuds immédiatement
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let audioSource: MediaElementAudioSourceNode | null = null;
  const audio = new Audio();
  
  // Créer un analyseur temporaire pour éviter les erreurs avant l'initialisation
  const tempContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const tempAnalyser = tempContext.createAnalyser();
  tempContext.suspend();

  // Cette fonction sera appelée au premier clic/interaction utilisateur
  const initAudioContext = async () => {
    if (!context) {
      try {
        context = new (window.AudioContext || (window as any).webkitAudioContext)();
        analyser = context.createAnalyser();
        audioSource = context.createMediaElementSource(audio);
        audioSource.connect(analyser);
        analyser.connect(context.destination);
        console.log("AudioContext initialized successfully");
      } catch (error) {
        console.error("Error initializing AudioContext:", error);
      }
    } else if (context.state === "suspended") {
      try {
        await context.resume();
        console.log("AudioContext resumed successfully");
      } catch (error) {
        console.error("Error resuming AudioContext:", error);
      }
    }
  };

  const onStateChange = () => {
    if (options.onStateChange) options.onStateChange();
    if (manager.onStateChange) manager.onStateChange();
  };
  
  const onTimeUpdate = () => {
    if (options.onTimeUpdate) options.onTimeUpdate(audio.currentTime, audio.duration);
    if (manager.onTimeUpdate) manager.onTimeUpdate(audio.currentTime, audio.duration);
  };
  
  const onEnded = () => {
    manager.queueManager.next();
    manager.play();
  };

  const storageManager = createStorageManager();
  const queueManager = createQueueManager({
    onUpdate: (song) => {
      if (song) manager.setPlaying(song);
      if (options?.onNext) options.onNext(song);
      if (options.onTimeUpdate) options.onTimeUpdate(0, 0);
      if (manager.onTimeUpdate) manager.onTimeUpdate(0, 0);
    },
    onSongListUpdated,
  });

  // Ajouter des écouteurs d'événements sans initialiser l'AudioContext
  const setupEventListeners = () => {
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("play", onStateChange);
    audio.addEventListener("pause", onStateChange);
    audio.addEventListener("ended", onEnded);
    queueManager.setSongs(storageManager.loadSongs());
  };

  const manager: MusicManager = {
    queueManager,
    storageManager,
    // Getter pour analyser, retourne l'analyseur réel ou temporaire
    get analyser() {
      return analyser || tempAnalyser;
    },
    getTime(): number {
      return audio.currentTime;
    },
    getDuration(): number {
      return audio.duration;
    },
    setTime(time: number) {
      audio.currentTime = time;
    },
    isPaused(): boolean {
      return !context || context.state === "suspended" || (audio != null && audio.paused);
    },
    getVolume(): number {
      return audio.volume;
    },
    setVolume(v: number) {
      audio.volume = v;
    },
    async play() {
      // Initialiser l'AudioContext au premier clic
      await initAudioContext();
      
      try {
        if (audio.readyState >= 2) { // HAVE_CURRENT_DATA or higher
          await audio.play();
        } else {
          // Si l'audio n'est pas prêt, attendre qu'il le soit
          const canPlayHandler = async () => {
            audio.removeEventListener('canplay', canPlayHandler);
            try {
              await audio.play();
            } catch (error) {
              console.error("Error during delayed play:", error);
            }
          };
          audio.addEventListener('canplay', canPlayHandler);
        }
      } catch (error) {
        console.error("Error playing audio:", error);
      }
    },
    pause() {
      audio.pause();
    },
    setPlaying(song) {
      const wasPlaying = !this.isPaused();
      audio.src = song.url;
      
      // Précharger l'audio
      audio.load();

      if (wasPlaying) {
        this.play();
      }
    },
    destroy() {
      this.pause();
      audio.removeEventListener("play", onStateChange);
      audio.removeEventListener("pause", onStateChange);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      
      // Nettoyer les contextes audio
      if (context && context.state !== "closed") {
        context.close();
      }
      if (tempContext && tempContext.state !== "closed") {
        tempContext.close();
      }
    },
  };

  // Configurer les écouteurs d'événements
  setupEventListeners();

  return manager;
}
