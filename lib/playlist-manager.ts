// lib/playlist-manager.ts
import { Song } from "@/music/data";
import { createStorageManager } from "@/lib/storage-manager";

export interface Playlist {
  id: string;
  name: string;
  songs: string[]; // URLs of songs in playlist
  createdAt: number;
}

export interface PlaylistManagerOptions {
  onPlaylistUpdated?: (playlists: Playlist[]) => void;
}

export interface PlaylistManager {
  playlists: Playlist[];
  
  createPlaylist(name: string): Playlist;
  addToPlaylist(playlistId: string, songUrl: string): void;
  removeFromPlaylist(playlistId: string, songUrl: string): void;
  deletePlaylist(playlistId: string): void;
  getPlaylistSongs(playlistId: string, allSongs: Song[]): Song[];
}

export function createPlaylistManager(options?: PlaylistManagerOptions): PlaylistManager {
  const storageManager = createStorageManager();
  
  // Load playlists from localStorage
  const getPlaylists = (): Playlist[] => {
    const playlistsJSON = localStorage.getItem("playlists");
    if (playlistsJSON) {
      return JSON.parse(playlistsJSON);
    }
    return [];
  };
  
  // Save playlists to localStorage
  const savePlaylists = (playlists: Playlist[]) => {
    localStorage.setItem("playlists", JSON.stringify(playlists));
    options?.onPlaylistUpdated?.(playlists);
  };
  
  return {
    playlists: getPlaylists(),
    
    createPlaylist(name: string): Playlist {
      const playlists = getPlaylists();
      const newPlaylist: Playlist = {
        id: `playlist_${Date.now()}`,
        name,
        songs: [],
        createdAt: Date.now()
      };
      
      playlists.push(newPlaylist);
      savePlaylists(playlists);
      this.playlists = playlists;
      
      return newPlaylist;
    },
    
    addToPlaylist(playlistId: string, songUrl: string): void {
      const playlists = getPlaylists();
      const playlist = playlists.find(p => p.id === playlistId);
      
      if (playlist && !playlist.songs.includes(songUrl)) {
        playlist.songs.push(songUrl);
        savePlaylists(playlists);
        this.playlists = playlists;
      }
    },
    
    removeFromPlaylist(playlistId: string, songUrl: string): void {
      const playlists = getPlaylists();
      const playlist = playlists.find(p => p.id === playlistId);
      
      if (playlist) {
        playlist.songs = playlist.songs.filter(url => url !== songUrl);
        savePlaylists(playlists);
        this.playlists = playlists;
      }
    },
    
    deletePlaylist(playlistId: string): void {
      const playlists = getPlaylists();
      const updatedPlaylists = playlists.filter(p => p.id !== playlistId);
      
      savePlaylists(updatedPlaylists);
      this.playlists = updatedPlaylists;
    },
    
    getPlaylistSongs(playlistId: string, allSongs: Song[]): Song[] {
      const playlists = getPlaylists();
      const playlist = playlists.find(p => p.id === playlistId);
      
      if (!playlist) return [];
      
      return allSongs.filter(song => playlist.songs.includes(song.url));
    }
  };
}
