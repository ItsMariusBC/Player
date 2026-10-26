// components/song-recognition.tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { MetadataFetcher, SongMetadata } from "@/lib/metadata-fetcher";
import { MusicManager } from "@/lib/music-manager";
import { Song } from "@/music/data";

export function SongRecognitionDialog({ 
  musicManager 
}: { 
  musicManager: MusicManager 
}) {
  const [open, setOpen] = useState(false);
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn(
          buttonVariants({
            variant: "secondary",
          }),
        )}
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
          className="size-5"
        >
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
        Identifier
      </DialogTrigger>
      <DialogContent>
        <SongRecognition 
          musicManager={musicManager} 
          onClose={() => setOpen(false)} 
        />
      </DialogContent>
    </Dialog>
  );
}

function SongRecognition({
  musicManager,
  onClose
}: {
  musicManager: MusicManager;
  onClose: () => void;
}) {
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [metadata, setMetadata] = useState<SongMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const currentSong = musicManager.queueManager.getCurrentSong();
  
  const recognizeCurrent = async () => {
    if (!currentSong) {
      setError('Aucune chanson n\'est en cours de lecture');
      return;
    }
    
    setIsRecognizing(true);
    setError(null);
    setMetadata(null);
    
    // Simuler la progression pour une meilleure expérience utilisateur
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 95) {
          clearInterval(interval);
          return prev;
        }
        return prev + 5;
      });
    }, 100);
    
    try {
      // Essayer de récupérer les métadonnées pour la chanson en cours
      const result = await MetadataFetcher.fetchByUrl(currentSong.url);
      
      setProgress(100);
      setMetadata(result);
      
      if (!result) {
        setError('Impossible d\'identifier cette chanson');
      }
    } catch (err) {
      setError('Erreur lors de la reconnaissance');
      console.error(err);
    } finally {
      clearInterval(interval);
      setIsRecognizing(false);
      setProgress(0);
    }
  };
  
  const saveMetadata = () => {
    if (!metadata || !currentSong) return;
    
    // Mettre à jour la chanson dans la liste des chansons personnalisées
    const customSongs = musicManager.storageManager.getCustomSongs();
    const updatedSongs = customSongs.map(song => {
      if (song.url === currentSong.url) {
        return {
          ...song,
          name: metadata.title,
          author: metadata.artist,
          picture: metadata.coverUrl
        };
      }
      return song;
    });
    
    musicManager.storageManager.saveCustomSongs(updatedSongs);
    
    // Mettre à jour la file d'attente actuelle
    const queueSongs = musicManager.queueManager.songs.map(song => {
      if (song.url === currentSong.url) {
        return {
          ...song,
          name: metadata.title,
          author: metadata.artist,
          picture: metadata.coverUrl
        };
      }
      return song;
    });
    
    musicManager.queueManager.setSongs(queueSongs);
    onClose();
  };
  
  const manualUpdate = (song: Song) => {
    const customSongs = musicManager.storageManager.getCustomSongs();
    const updatedSongs = customSongs.map(s => {
      if (s.url === song.url) {
        return song;
      }
      return s;
    });
    
    musicManager.storageManager.saveCustomSongs(updatedSongs);
    
    // Mettre à jour la file d'attente actuelle
    const queueSongs = musicManager.queueManager.songs.map(s => {
      if (s.url === song.url) {
        return { ...s, ...song };
      }
      return s;
    });
    
    musicManager.queueManager.setSongs(queueSongs);
    onClose();
  };
  
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-medium">Identifier la chanson actuelle</h2>
        <p className="text-purple-200 text-sm mb-4">
          Obtenir les métadonnées de la chanson en cours de lecture
        </p>
      </div>
      
      {currentSong ? (
        <div className="flex items-center gap-3 p-3 bg-purple-200/5 rounded-lg">
          {currentSong.picture ? (
            <img 
              src={currentSong.picture} 
              alt={currentSong.name} 
              className="w-12 h-12 rounded"
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
            <p className="font-medium">{currentSong.name}</p>
            <p className="text-xs text-purple-200">{currentSong.author}</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center p-4 bg-purple-200/5 rounded-lg">
          <p className="text-purple-200 text-sm">Aucune chanson en cours de lecture</p>
        </div>
      )}
      
      {isRecognizing ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-center">Écoute et identification en cours...</p>
          <div className="w-full h-2 bg-purple-200/10 rounded-full overflow-hidden">
            <div 
              className="h-full bg-purple-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : (
        <button
          onClick={recognizeCurrent}
          disabled={!currentSong}
          className={cn(buttonVariants({ variant: "primary", className: "w-full" }))}
        >
          Identifier la chanson
        </button>
      )}
      
      {error && (
        <div className="p-3 bg-red-500/20 text-red-200 rounded-lg text-sm">
          {error}
        </div>
      )}
      
      {metadata && (
        <div className="flex flex-col gap-3 p-3 bg-purple-200/5 rounded-lg">
          <h3 className="font-medium">Informations trouvées</h3>
          
          <div className="flex items-start gap-3">
            {metadata.coverUrl && (
              <img 
                src={metadata.coverUrl} 
                alt={metadata.title} 
                className="w-20 h-20 rounded"
              />
            )}
            
            <div>
              <p><span className="text-purple-200">Titre:</span> {metadata.title}</p>
              <p><span className="text-purple-200">Artiste:</span> {metadata.artist}</p>
              {metadata.album && (
                <p><span className="text-purple-200">Album:</span> {metadata.album}</p>
              )}
              {metadata.year && (
                <p><span className="text-purple-200">Année:</span> {metadata.year}</p>
              )}
              {metadata.genre && (
                <p><span className="text-purple-200">Genre:</span> {metadata.genre}</p>
              )}
            </div>
          </div>
          
          <button
            onClick={saveMetadata}
            className={cn(buttonVariants({ variant: "primary" }))}
          >
            Sauvegarder les métadonnées
          </button>
        </div>
      )}
      
      {/* Option de saisie manuelle de métadonnées */}
      {currentSong && !metadata && !isRecognizing && (
        <div className="mt-2 pt-3 border-t border-purple-200/10">
          <h3 className="font-medium mb-2">Ou saisir les métadonnées manuellement</h3>
          <ManualMetadataForm 
            song={currentSong} 
            onSubmit={manualUpdate} 
          />
        </div>
      )}
    </div>
  );
}

function ManualMetadataForm({
  song,
  onSubmit
}: {
  song: Song;
  onSubmit: (song: Song) => void;
}) {
  const [name, setName] = useState(song.name);
  const [author, setAuthor] = useState(song.author);
  const [picture, setPicture] = useState(song.picture || '');
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...song,
      name,
      author,
      picture: picture || undefined
    });
  };
  
  const inputVariants = "bg-transparent rounded-lg bg-purple-200/10 text-sm px-2 py-1 -mx-2 placeholder:text-purple-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400";
  
  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-xs font-medium">
          Titre
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputVariants}
          required
        />
      </div>
      
      <div className="flex flex-col gap-1">
        <label htmlFor="author" className="text-xs font-medium">
          Artiste
        </label>
        <input
          id="author"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          className={inputVariants}
          required
        />
      </div>
      
      <div className="flex flex-col gap-1">
        <label htmlFor="picture" className="text-xs font-medium">
          URL de la pochette
        </label>
        <input
          id="picture"
          value={picture}
          onChange={(e) => setPicture(e.target.value)}
          type="url"
          className={inputVariants}
          placeholder="https://example.com/image.jpg"
        />
      </div>
      
      <button
        type="submit"
        className={cn(buttonVariants({ variant: "primary", className: "w-full mt-2" }))}
      >
        Mettre à jour les métadonnées
      </button>
    </form>
  );
}