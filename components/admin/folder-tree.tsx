// components/admin/folder-tree.tsx
// Left column of the admin panel: « Boîte d'arrivée » first, then the folder tree. Rows
// select a folder, accept dropped track rows and open the folder menu on right click.
// Renaming and « Nouveau dossier » are inline inputs (Entrée validates, Échap cancels).
// Folder rows are also draggable: the top and bottom quarters of a target row insert the
// dragged folder before or after it, the middle drops it inside.
import { useEffect, useRef, useState, type RefObject } from "react";
import type { FolderNode, TrackDto } from "@/lib/catalog";
import {
  FOLDER_DRAG_TYPE,
  INBOX_LABEL,
  TRACK_DRAG_TYPE,
  folderDropZone,
  tracksInFolder,
  type FolderDropZone,
} from "@/lib/admin-format";
import { cn } from "@/lib/cn";

const INBOX_KEY = "__inbox__";

export const inputClass =
  "w-full rounded-md border border-purple-100/10 bg-purple-950/30 px-2.5 py-1.5 text-sm text-purple-50 placeholder:text-purple-200/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-400/60";

const rowClass = (selected: boolean, dropping: boolean, dragging = false) =>
  cn(
    "relative flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
    "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-400/60",
    dropping
      ? "bg-purple-400/25 text-purple-50 ring-1 ring-purple-300/40"
      : selected
        ? "bg-purple-500/20 text-purple-50"
        : "text-purple-100/80 hover:bg-purple-200/5",
    dragging && "opacity-40",
  );

/** Insertion line drawn above or below a row while a folder hovers its edge. */
const insertLineClass = (zone: "before" | "after") =>
  cn(
    "pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-purple-300",
    zone === "before" ? "-top-0.5" : "-bottom-0.5",
  );

export interface FolderTreeProps {
  folders: FolderNode[];
  tracks: TrackDto[];
  /** null = the inbox. */
  selectedId: string | null;
  onSelect: (folderId: string | null) => void;
  /** A track row was dropped on a folder (null = the inbox). */
  onDropTrack: (trackId: string, folderId: string | null) => void;
  /** A folder row was dropped on another folder row, in the given zone. */
  onDropFolder: (folderId: string, targetId: string, zone: FolderDropZone) => void;
  onFolderMenu: (folderId: string, x: number, y: number) => void;
  /** Folder whose name is being edited inline. */
  renamingId: string | null;
  onRename: (folderId: string, name: string) => void;
  onCancelRename: () => void;
  onCreate: (name: string) => void;
  /** Path of the folder « Nouveau dossier » creates into (undefined at the root). */
  createIntoLabel?: string;
  /** The inbox row, focused when the panel opens. */
  firstItemRef: RefObject<HTMLButtonElement | null>;
}

export function FolderTree(props: FolderTreeProps) {
  const { folders, tracks, selectedId, onSelect, firstItemRef } = props;
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [folderDrop, setFolderDrop] = useState<{ id: string; zone: FolderDropZone } | null>(
    null,
  );
  const [creating, setCreating] = useState(false);

  // A drag that ends anywhere (drop elsewhere, Escape) clears the highlights.
  useEffect(() => {
    const clear = () => {
      setDropKey(null);
      setDraggingId(null);
      setFolderDrop(null);
    };
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, []);

  const dropHandlers = (folderId: string | null) => {
    const key = folderId ?? INBOX_KEY;
    // The inbox is not a folder: it takes tracks only.
    const acceptsFolder = folderId !== null;
    return {
      onDragOver: (event: React.DragEvent) => {
        const { types } = event.dataTransfer;
        if (types.includes(TRACK_DRAG_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropKey(key);
          return;
        }
        if (!acceptsFolder || !types.includes(FOLDER_DRAG_TYPE)) return;
        if (draggingId === folderId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        const zone = folderDropZone(event.clientY - rect.top, rect.height);
        setFolderDrop((current) =>
          current?.id === folderId && current.zone === zone ? current : { id: folderId, zone },
        );
      },
      onDragLeave: (event: React.DragEvent) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropKey((current) => (current === key ? null : current));
        setFolderDrop((current) => (current?.id === folderId ? null : current));
      },
      onDrop: (event: React.DragEvent) => {
        const trackId = event.dataTransfer.getData(TRACK_DRAG_TYPE);
        if (trackId) {
          event.preventDefault();
          setDropKey(null);
          props.onDropTrack(trackId, folderId);
          return;
        }
        const draggedId = event.dataTransfer.getData(FOLDER_DRAG_TYPE);
        if (!draggedId || !acceptsFolder || draggedId === folderId) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const zone = folderDropZone(event.clientY - rect.top, rect.height);
        setFolderDrop(null);
        setDraggingId(null);
        props.onDropFolder(draggedId, folderId, zone);
      },
    };
  };

  const dragHandlers = (folderId: string) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.setData(FOLDER_DRAG_TYPE, folderId);
      event.dataTransfer.effectAllowed = "move";
      setDraggingId(folderId);
    },
  });

  const inboxCount = tracksInFolder(folders, tracks, null).length;

  const renderNode = (node: FolderNode, depth: number) => {
    const count = tracks.filter((track) => track.folderId === node.id).length;
    const selected = selectedId === node.id;
    return (
      <li key={node.id}>
        {props.renamingId === node.id ? (
          <div style={{ paddingLeft: `${depth * 0.75}rem` }}>
            <InlineInput
              label="Renommer le dossier"
              initial={node.name}
              onSubmit={(name) => props.onRename(node.id, name)}
              onCancel={props.onCancelRename}
            />
          </div>
        ) : (
          <button
            type="button"
            aria-current={selected ? "true" : undefined}
            className={rowClass(
              selected,
              dropKey === node.id || (folderDrop?.id === node.id && folderDrop.zone === "inside"),
              draggingId === node.id,
            )}
            style={{ paddingLeft: `${0.625 + depth * 0.75}rem` }}
            onClick={() => onSelect(node.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              const { x, y } = menuPoint(event);
              onSelect(node.id);
              props.onFolderMenu(node.id, x, y);
            }}
            {...dropHandlers(node.id)}
            {...dragHandlers(node.id)}
          >
            {folderDrop?.id === node.id && folderDrop.zone !== "inside" && (
              <span aria-hidden="true" className={insertLineClass(folderDrop.zone)} />
            )}
            <span className="truncate">{node.name}</span>
            <span className="text-xs tabular-nums text-purple-200/50">{count}</span>
          </button>
        )}
        {node.children.length > 0 && (
          <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <nav aria-label="Dossiers" className="flex min-h-0 flex-col gap-3">
      <ul className="flex flex-col gap-0.5">
        <li>
          <button
            ref={firstItemRef}
            type="button"
            aria-current={selectedId === null ? "true" : undefined}
            className={rowClass(selectedId === null, dropKey === INBOX_KEY)}
            onClick={() => onSelect(null)}
            {...dropHandlers(null)}
          >
            <span className="truncate">{INBOX_LABEL}</span>
            <span className="text-xs tabular-nums text-purple-200/50">{inboxCount}</span>
          </button>
        </li>
        {folders.map((node) => renderNode(node, 0))}
      </ul>
      {creating ? (
        <div className="flex flex-col gap-1">
          <InlineInput
            label="Nom du nouveau dossier"
            initial=""
            onSubmit={(name) => {
              setCreating(false);
              props.onCreate(name);
            }}
            onCancel={() => setCreating(false)}
          />
          {props.createIntoLabel && (
            <span className="px-1 text-xs text-purple-200/50">dans {props.createIntoLabel}</span>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="self-start rounded-md px-2.5 py-1.5 text-sm text-purple-200/70 transition-colors hover:text-purple-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-400/60"
          onClick={() => setCreating(true)}
        >
          + Nouveau dossier
        </button>
      )}
    </nav>
  );
}

/** Keyboard-opened context menus (menu key, Shift+F10) come at 0,0: anchor them to the row. */
export function menuPoint(event: React.MouseEvent<HTMLElement>): { x: number; y: number } {
  if (event.clientX !== 0 || event.clientY !== 0) return { x: event.clientX, y: event.clientY };
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left + 16, y: rect.bottom };
}

/** Entrée submits a non-empty trimmed value, Échap or leaving the field cancels. */
function InlineInput({
  label,
  initial,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  // The field appears on an explicit user action: take the focus and select the text.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      aria-label={label}
      maxLength={200}
      value={value}
      className={inputClass}
      onChange={(event) => setValue(event.target.value)}
      onBlur={onCancel}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          const name = value.trim();
          if (name) onSubmit(name);
          else onCancel();
        } else if (event.key === "Escape") {
          // Handled here: the panel's Escape listener skips prevented events.
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
}
