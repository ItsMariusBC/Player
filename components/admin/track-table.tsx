// components/admin/track-table.tsx
// Centre of the admin panel: the tracks of the selected folder, in queue order. Rows select
// the track, drag onto a folder of the tree and open the track menu on right click.
import type { TrackDto } from "@/lib/catalog";
import { coverUrl } from "@/lib/catalog";
import { TRACK_DRAG_TYPE, formatDuration } from "@/lib/admin-format";
import { menuPoint } from "@/components/admin/folder-tree";
import { cn } from "@/lib/cn";

const headClass = "px-2 py-2 text-left text-xs font-normal uppercase tracking-widest text-purple-200/50";
const cellClass = "px-2 py-1.5";

export function TrackTable({
  tracks,
  selectedId,
  onSelect,
  onTrackMenu,
}: {
  /** Already sorted (tracksInFolder). */
  tracks: TrackDto[];
  selectedId: string | null;
  onSelect: (trackId: string) => void;
  onTrackMenu: (trackId: string, x: number, y: number) => void;
}) {
  if (tracks.length === 0) {
    return <p className="px-2 py-6 text-sm text-purple-200/50">Aucun titre</p>;
  }

  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <thead className="sticky top-0 bg-purple-950/60 backdrop-blur-xs">
        <tr className="border-b border-purple-100/10">
          <th scope="col" className={cn(headClass, "w-12")}>
            <span className="sr-only">Pochette</span>
          </th>
          <th scope="col" className={headClass}>
            Titre
          </th>
          <th scope="col" className={cn(headClass, "hidden lg:table-cell")}>
            Artiste
          </th>
          <th scope="col" className={cn(headClass, "hidden xl:table-cell")}>
            Album
          </th>
          <th scope="col" className={cn(headClass, "w-20 text-right")}>
            Durée
          </th>
          <th scope="col" className={cn(headClass, "w-20 text-right")}>
            Format
          </th>
        </tr>
      </thead>
      <tbody>
        {tracks.map((track) => {
          const selected = track.id === selectedId;
          return (
            <tr
              key={track.id}
              data-track-id={track.id}
              tabIndex={0}
              draggable
              aria-current={selected ? "true" : undefined}
              aria-label={track.artist ? `${track.title}, ${track.artist}` : track.title}
              className={cn(
                "cursor-default border-b border-purple-100/5 transition-colors",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-400/60",
                selected ? "bg-purple-500/20" : "hover:bg-purple-200/5",
              )}
              onClick={() => onSelect(track.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(track.id);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                const { x, y } = menuPoint(event);
                onSelect(track.id);
                onTrackMenu(track.id, x, y);
              }}
              onDragStart={(event) => {
                event.dataTransfer.setData(TRACK_DRAG_TYPE, track.id);
                event.dataTransfer.effectAllowed = "move";
              }}
            >
              <td className={cellClass}>
                {track.hasCover ? (
                  <img
                    src={coverUrl(track.id, track.updatedAt)}
                    alt=""
                    width={32}
                    height={32}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className="size-8 rounded-sm object-cover"
                  />
                ) : (
                  <div className="size-8 rounded-sm bg-purple-400/10" />
                )}
              </td>
              <td className={cn(cellClass, "truncate text-purple-50")}>
                {track.title}
                <span className="block truncate text-xs text-purple-200/60 lg:hidden">
                  {track.artist}
                </span>
              </td>
              <td className={cn(cellClass, "hidden truncate text-purple-200/80 lg:table-cell")}>
                {track.artist}
              </td>
              <td className={cn(cellClass, "hidden truncate text-purple-200/80 xl:table-cell")}>
                {track.album}
              </td>
              <td className={cn(cellClass, "text-right tabular-nums text-purple-200/70")}>
                {formatDuration(track.durationMs)}
              </td>
              <td className={cn(cellClass, "text-right text-xs uppercase text-purple-200/60")}>
                {track.format}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
