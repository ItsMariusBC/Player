// components/song-list.tsx
// Queue shown as the catalogue tree. Folders nest (indented per level) and
// collapse; the folders holding the current track open themselves. Each level
// lists its subfolders, then its own tracks: the queue order of flattenCatalog.
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { MusicManager } from "@/lib/music-manager";
import { PlaybackController } from "@/lib/playback-controller";
import { QueueItem } from "@/lib/queue-manager";
import { usePlaybackState } from "@/lib/hooks/use-playback-state";
import { type FolderNode, folderAncestors } from "@/lib/catalog";
import { cn } from "@/lib/cn";

interface TreeContext {
  songsByFolder: Map<string | null, QueueItem[]>;
  collapsed: Set<string>;
  currentId: string | undefined;
  currentPath: string[];
  onToggle: (folderId: string) => void;
  onSelect: (song: QueueItem) => void;
}

function countTracks(node: FolderNode, songsByFolder: Map<string | null, QueueItem[]>): number {
  let total = songsByFolder.get(node.id)?.length ?? 0;
  for (const child of node.children) total += countTracks(child, songsByFolder);
  return total;
}

export function SongList({
  music,
  playback,
  folders,
}: {
  music: MusicManager;
  playback: PlaybackController;
  folders: FolderNode[];
}) {
  const { songs, currentSong } = usePlaybackState(music);
  const ancestors = useMemo(() => folderAncestors(folders), [folders]);
  const songsByFolder = useMemo(() => {
    const map = new Map<string | null, QueueItem[]>();
    for (const song of songs) {
      const list = map.get(song.folderId);
      if (list) list.push(song);
      else map.set(song.folderId, [song]);
    }
    return map;
  }, [songs]);
  const currentFolderId = currentSong?.folderId ?? null;
  const currentPath = useMemo(
    () => (currentFolderId === null ? [] : (ancestors.get(currentFolderId) ?? [])),
    [ancestors, currentFolderId],
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const initial = new Set(ancestors.keys());
    for (const id of currentPath) initial.delete(id);
    return initial;
  });

  // The folders on the path of the track being played always open.
  useEffect(() => {
    if (currentPath.length === 0) return;
    setCollapsed((prev) => {
      if (!currentPath.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of currentPath) next.delete(id);
      return next;
    });
  }, [currentPath]);

  const toggle = (folderId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });

  if (songs.length === 0) {
    return (
      <div className="text-center py-8 text-purple-200">
        <p>Aucune chanson dans la file d'attente</p>
        <p className="text-sm mt-2">Le catalogue est vide</p>
      </div>
    );
  }

  const context: TreeContext = {
    songsByFolder,
    collapsed,
    currentId: currentSong?.id,
    currentPath,
    onToggle: toggle,
    onSelect: playback.playSong,
  };
  const rootSongs = songsByFolder.get(null) ?? [];

  return (
    <div className="space-y-1">
      {folders.map((node) => (
        <Folder key={node.id} node={node} context={context} />
      ))}
      {rootSongs.length > 0 && (
        <div className="space-y-1">
          {rootSongs.map((song) => (
            <SongRow key={song.id} song={song} active={song.id === context.currentId} onSelect={context.onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function Folder({ node, context }: { node: FolderNode; context: TreeContext }) {
  const open = !context.collapsed.has(node.id);
  const holdsCurrent = context.currentPath.includes(node.id);
  const songs = context.songsByFolder.get(node.id) ?? [];
  const count = countTracks(node, context.songsByFolder);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => context.onToggle(node.id)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
          "hover:bg-purple-200/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-400/60",
        )}
      >
        <ChevronIcon className={cn("size-3.5 shrink-0 text-purple-200/60 transition-transform duration-200", open && "rotate-90")} />
        <FolderIcon className="size-4 shrink-0 text-purple-200/80" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{node.name}</span>
        {holdsCurrent && !open && <span className="size-2 rounded-full bg-purple-500 animate-pulse" />}
        <span className="text-xs tabular-nums text-purple-200/60">{count}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <m.div
            key="content"
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <div className="ml-4 space-y-1 border-l border-purple-100/10 pl-2 py-1">
              {node.children.map((child) => (
                <Folder key={child.id} node={child} context={context} />
              ))}
              {songs.map((song) => (
                <SongRow key={song.id} song={song} active={song.id === context.currentId} onSelect={context.onSelect} />
              ))}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SongRow({ song, active, onSelect }: { song: QueueItem; active: boolean; onSelect: (song: QueueItem) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(song)}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-400/60",
        active ? "bg-purple-500/20" : "hover:bg-purple-200/5",
      )}
    >
      {song.picture ? (
        <img
          src={song.picture}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          className="size-10 rounded-sm object-cover"
        />
      ) : (
        <div className="flex size-10 items-center justify-center rounded-sm bg-purple-400/10">
          <NoteIcon />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{song.name}</div>
        <div className="truncate text-xs text-purple-200">{song.author}</div>
      </div>
      {active && <div className="size-2 rounded-full bg-purple-500 animate-pulse" />}
    </button>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}
