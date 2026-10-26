// components/control/playlists.tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { MusicManager } from "@/lib/music-manager";
import { createPlaylistManager, Playlist } from "@/lib/playlist-manager";

const inputVariants = "bg-transparent rounded-lg bg-purple-200/10 text-sm px-2 py-1 -mx-2 placeholder:text-purple-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400";

export function PlaylistsDialog({ musicManager }: { musicManager: MusicManager }) {
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
        Playlists
      </DialogTrigger>
      <DialogContent>
        <PlaylistManager 
          musicManager={musicManager} 
          onClose={() => setOpen(false)} 
        />
      </DialogContent>
    </Dialog>
  );
}

function PlaylistManager({ 
  musicManager, 
  onClose 
}: { 
  musicManager: MusicManager; 
  onClose: () => void 
}) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  
  // Initialize playlist manager
  const [playlistManager] = useState(() => 
    createPlaylistManager({
      onPlaylistUpdated: (updatedPlaylists) => {
        setPlaylists(updatedPlaylists);
      }
    })
  );
  
  // Load playlists on component mount
  useState(() => {
    setPlaylists(playlistManager.playlists);
  });
  
  const createNewPlaylist = () => {
    if (newPlaylistName.trim() === "") return;
    
    playlistManager.createPlaylist(newPlaylistName);
    setNewPlaylistName("");
  };
  
  const loadPlaylist = (playlist: Playlist) => {
    // Get songs from the playlist
    const allSongs = musicManager.storageManager.loadSongs();
    const playlistSongs = playlistManager.getPlaylistSongs(playlist.id, allSongs);
    
    // Set the queue to these songs
    musicManager.queueManager.setSongs(playlistSongs);
    
    // Close the dialog
    onClose();
  };
  
  const addCurrentSongToPlaylist = (playlist: Playlist) => {
    const currentSong = musicManager.queueManager.getCurrentSong();
    if (currentSong) {
      playlistManager.addToPlaylist(playlist.id, currentSong.url);
    }
  };
  
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-medium">Your Playlists</h2>
        <p className="text-purple-200 text-sm mb-4">
          Organize your music into playlists
        </p>
      </div>
      
      {/* Create new playlist */}
      <div className="flex items-center gap-2">
        <input
          value={newPlaylistName}
          onChange={(e) => setNewPlaylistName(e.target.value)}
          placeholder="New playlist name"
          className={inputVariants}
        />
        <button
          onClick={createNewPlaylist}
          className={cn(buttonVariants({ variant: "primary" }))}
          disabled={newPlaylistName.trim() === ""}
        >
          Create
        </button>
      </div>
      
      {/* Playlist list */}
      <div className="max-h-60 overflow-y-auto">
        {playlists.length === 0 ? (
          <p className="text-purple-200 text-sm italic">No playlists yet. Create one!</p>
        ) : (
          <ul className="space-y-2">
            {playlists.map((playlist) => (
              <li 
                key={playlist.id} 
                className={cn(
                  "flex items-center justify-between rounded-lg p-2",
                  activePlaylist?.id === playlist.id ? "bg-purple-500/20" : "hover:bg-purple-200/5"
                )}
              >
                <button 
                  className="flex-1 text-left"
                  onClick={() => setActivePlaylist(playlist)}
                >
                  {playlist.name} 
                  <span className="text-xs text-purple-300 ml-2">
                    ({playlist.songs.length} songs)
                  </span>
                </button>
                <div className="flex gap-1">
                  <button
                    onClick={() => loadPlaylist(playlist)}
                    className={cn(buttonVariants({ variant: "secondary" }))}
                    title="Play playlist"
                  >
                    <svg
                      width="16" height="16" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    >
                      <polygon points="6 3 20 12 6 21 6 3" />
                    </svg>
                  </button>
                  <button
                    onClick={() => addCurrentSongToPlaylist(playlist)}
                    className={cn(buttonVariants({ variant: "secondary" }))}
                    title="Add current song"
                  >
                    <svg
                      width="16" height="16" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    >
                      <path d="M12 5v14" />
                      <path d="M5 12h14" />
                    </svg>
                  </button>
                  <button
                    onClick={() => playlistManager.deletePlaylist(playlist.id)}
                    className={cn(buttonVariants({ variant: "destructive" }))}
                    title="Delete playlist"
                  >
                    <svg
                      width="16" height="16" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      
      {/* Display songs in selected playlist */}
      {activePlaylist && (
        <div className="mt-2">
          <h3 className="font-medium text-sm border-t border-purple-300/20 pt-2 mb-2">
            Songs in "{activePlaylist.name}"
          </h3>
          <div className="max-h-40 overflow-y-auto">
            {(() => {
              const allSongs = musicManager.storageManager.loadSongs();
              const playlistSongs = playlistManager.getPlaylistSongs(activePlaylist.id, allSongs);
              
              if (playlistSongs.length === 0) {
                return <p className="text-purple-200 text-sm italic">No songs in this playlist yet</p>;
              }
              
              return (
                <ul className="space-y-2">
                  {playlistSongs.map((song, index) => (
                    <li 
                      key={`${song.url}-${index}`}
                      className="flex items-center justify-between rounded-lg p-2 hover:bg-purple-200/5"
                    >
                      <div className="flex items-center gap-2">
                        {song.picture && (
                          <img src={song.picture} alt={song.name} className="w-8 h-8 rounded-md" />
                        )}
                        <div>
                          <p className="text-sm font-medium">{song.name}</p>
                          <p className="text-xs text-purple-200">{song.author}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => playlistManager.removeFromPlaylist(activePlaylist.id, song.url)}
                        className={cn(buttonVariants({ variant: "destructive" }))}
                        title="Remove from playlist"
                      >
                        <svg
                          width="16" height="16" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        >
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
