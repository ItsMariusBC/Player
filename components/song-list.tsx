// components/song-list.tsx
// Queue grouped by folder. Folders collapse; the one holding the current track opens itself.
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { MusicManager } from "@/lib/music-manager";
import { PlaybackController } from "@/lib/playback-controller";
import { QueueItem } from "@/lib/queue-manager";
import { usePlaybackState } from "@/lib/hooks/use-playback-state";
import { cn } from "@/lib/cn";

interface Group {
  folder: string | null;
  songs: QueueItem[];
}

/** Folders in order of first appearance, root songs last. */
export function groupByFolder(songs: QueueItem[]): Group[] {
  const groups = new Map<string, Group>();
  const root: QueueItem[] = [];
  for (const song of songs) {
    if (!song.folder) {
      root.push(song);
      continue;
    }
    let group = groups.get(song.folder);
    if (!group) {
      group = { folder: song.folder, songs: [] };
      groups.set(song.folder, group);
    }
    group.songs.push(song);
  }
  const result = [...groups.values()];
  if (root.length > 0) result.push({ folder: null, songs: root });
  return result;
}

export function SongList({ music, playback }: { music: MusicManager; playback: PlaybackController }) {
  const { songs, currentSong } = usePlaybackState(music);
  const groups = useMemo(() => groupByFolder(songs), [songs]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const song of songs) if (song.folder && song.folder !== currentSong?.folder) initial.add(song.folder);
    return initial;
  });

  // The folder of the track being played always opens.
  useEffect(() => {
    const folder = currentSong?.folder;
    if (!folder) return;
    setCollapsed((prev) => {
      if (!prev.has(folder)) return prev;
      const next = new Set(prev);
      next.delete(folder);
      return next;
    });
  }, [currentSong?.folder]);

  const toggle = (folder: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
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

  return (
    <div className="space-y-1">
      {groups.map((group) =>
        group.folder === null ? (
          <div key="root" className="space-y-1">
            {group.songs.map((song) => (
              <SongRow key={song.id} song={song} active={song.id === currentSong?.id} onSelect={playback.playSong} />
            ))}
          </div>
        ) : (
          <Folder
            key={group.folder}
            name={group.folder}
            songs={group.songs}
            open={!collapsed.has(group.folder)}
            currentId={currentSong?.id}
            onToggle={() => toggle(group.folder as string)}
            onSelect={playback.playSong}
          />
        ),
      )}
    </div>
  );
}

function Folder({
  name,
  songs,
  open,
  currentId,
  onToggle,
  onSelect,
}: {
  name: string;
  songs: QueueItem[];
  open: boolean;
  currentId: number | undefined;
  onToggle: () => void;
  onSelect: (song: QueueItem) => void;
}) {
  const holdsCurrent = songs.some((song) => song.id === currentId);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
          "hover:bg-purple-200/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-400/60",
        )}
      >
        <ChevronIcon className={cn("size-3.5 shrink-0 text-purple-200/60 transition-transform duration-200", open && "rotate-90")} />
        <FolderIcon className="size-4 shrink-0 text-purple-200/80" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        {holdsCurrent && !open && <span className="size-2 rounded-full bg-purple-500 animate-pulse" />}
        <span className="text-xs tabular-nums text-purple-200/60">{songs.length}</span>
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
              {songs.map((song) => (
                <SongRow key={song.id} song={song} active={song.id === currentId} onSelect={onSelect} />
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
