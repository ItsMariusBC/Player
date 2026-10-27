// components/admin/admin-panel.tsx
// Admin panel, sized and styled like the expanded visualizer (the page unmounts the rest of
// the UI while it is shown). Folders on the left, the tracks of the selected folder in the
// centre, the tag editor on the right. Every mutation goes through lib/admin-api, then
// reloads the admin catalogue and the player's one; a failure shows in the banner.
import { useCallback, useEffect, useRef, useState } from "react";
import { m } from "framer-motion";
import { PanelButton } from "@/components/visualizer-panel";
import { buttonVariants } from "@/components/ui/button";
import { ContextMenu, type MenuItem } from "@/components/admin/context-menu";
import { FolderTree } from "@/components/admin/folder-tree";
import { TrackEditor } from "@/components/admin/track-editor";
import { TrackTable } from "@/components/admin/track-table";
import * as adminApi from "@/lib/admin-api";
import {
  INBOX_LABEL,
  buildFolderPathLabel,
  countFolderItems,
  findFolder,
  flattenFolderOptions,
  tracksInFolder,
} from "@/lib/admin-format";
import { performLogout } from "@/lib/api";
import { useAdminCatalog } from "@/lib/hooks/use-admin-catalog";
import { cn } from "@/lib/cn";

type MenuState =
  | { kind: "track"; id: string; x: number; y: number; step: "main" | "confirm" }
  | { kind: "folder"; id: string; x: number; y: number; step: "main" | "confirm" };

const GENERIC_ERROR = "Action impossible";

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : GENERIC_ERROR;

const itemsLabel = (count: number) => (count === 1 ? "1 élément" : `${count} éléments`);

export interface AdminPanelProps {
  onClose: () => void;
  /** Reloads the player's catalogue (useCatalog().refresh). */
  onCatalogChanged: () => Promise<void> | void;
  /** « Rechercher les métadonnées » stays disabled until this is given (Task 12). */
  onSearchMetadata?: (trackId: string) => void;
}

export function AdminPanel({ onClose, onCatalogChanged, onSearchMetadata }: AdminPanelProps) {
  const [banner, setBanner] = useState<string | null>(null);
  const showError = useCallback((error: unknown) => {
    console.error("Admin action failed", error);
    setBanner(errorMessage(error));
  }, []);
  const { catalog, refreshAdmin } = useAdminCatalog(showError);
  const folders = catalog?.folders ?? [];
  const tracks = catalog?.tracks ?? [];

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // Runs in flight (a drag-move may overlap a save): the editor is disabled while any is.
  const [inFlight, setInFlight] = useState(0);
  const [lastSave, setLastSave] = useState<{ trackId: string; tagsWritten: boolean } | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ trackId: string; n: number } | null>(null);
  // Never reset, so a new request is always newer than any the editor already honoured.
  const focusCounter = useRef(0);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  // A folder or track that disappeared (deleted, moved by someone else) falls back cleanly.
  const folderId =
    selectedFolderId !== null && findFolder(folders, selectedFolderId) ? selectedFolderId : null;
  const visibleTracks = tracksInFolder(folders, tracks, folderId);
  const selectedTrack = tracks.find((track) => track.id === selectedTrackId);

  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Inline inputs and the context menu handle their own Escape first.
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  /** Runs one mutation, then reloads both catalogues. Never swallows an error. */
  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      setInFlight((n) => n + 1);
      try {
        await action();
        await Promise.all([refreshAdmin(), onCatalogChanged()]);
        return true;
      } catch (error) {
        showError(error);
        return false;
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [refreshAdmin, onCatalogChanged, showError],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const moveTrack = (trackId: string, target: string | null) => {
    const track = tracks.find((t) => t.id === trackId);
    if (!track || track.folderId === target) return;
    void run(() => adminApi.updateTrack(trackId, { folderId: target }));
  };

  const saveTrack = (trackId: string, patch: adminApi.TrackPatch) =>
    void run(async () => {
      const { tagsWritten } = await adminApi.updateTrack(trackId, patch);
      setLastSave({ trackId, tagsWritten });
    });

  const deleteTrack = (trackId: string) =>
    void run(async () => {
      await adminApi.deleteTrack(trackId);
      setSelectedTrackId((current) => (current === trackId ? null : current));
    });

  const createFolder = (name: string) =>
    void run(async () => {
      const folder = await adminApi.createFolder(name, folderId);
      setSelectedFolderId(folder.id);
      setSelectedTrackId(null);
    });

  const renameFolder = (id: string, name: string) => {
    setRenamingId(null);
    if (findFolder(folders, id)?.name === name) return;
    void run(() => adminApi.updateFolder(id, { name }));
  };

  const deleteFolder = (id: string, force: boolean) =>
    void run(() => adminApi.deleteFolder(id, { force }));

  const selectFolder = (id: string | null) => {
    if (id !== folderId) setSelectedTrackId(null);
    setSelectedFolderId(id);
    setFocusRequest(null);
  };

  // A plain selection (click, Enter, right click) never moves the focus into the editor;
  // only « Modifier » sets a focus request, and the next selection drops it.
  const selectTrack = (id: string) => {
    setSelectedTrackId(id);
    setFocusRequest(null);
  };

  const menuItems = (
    state: MenuState,
  ): { items: MenuItem[]; prompt?: string; label: string; initialFocusId?: string } => {
    if (state.kind === "track") {
      const track = tracks.find((t) => t.id === state.id);
      if (state.step === "confirm") {
        return {
          label: "Supprimer le titre",
          prompt: "Supprimer définitivement ?",
          // « Oui » stays first visually, but a repeated Enter must not delete.
          initialFocusId: "confirm-no",
          items: [
            {
              id: "confirm-yes",
              label: "Oui",
              destructive: true,
              onSelect: () => {
                closeMenu();
                deleteTrack(state.id);
              },
            },
            { id: "confirm-no", label: "Non", onSelect: closeMenu },
          ],
        };
      }
      const current = track?.folderId ?? null;
      const moveItem = (
        target: string | null,
        item: Omit<MenuItem, "onSelect" | "disabled">,
      ): MenuItem => ({
        ...item,
        disabled: target === current,
        onSelect: () => {
          closeMenu();
          moveTrack(state.id, target);
        },
      });
      const targets: MenuItem[] = [
        moveItem(null, { id: "move-inbox", label: INBOX_LABEL }),
        ...flattenFolderOptions(folders).map((option) =>
          moveItem(option.id, {
            id: `move-folder-${option.id}`,
            label: option.name,
            title: option.label,
            indent: option.depth,
          }),
        ),
      ];
      return {
        label: track ? `Actions pour ${track.title}` : "Actions du titre",
        items: [
          {
            id: "edit",
            label: "Modifier",
            onSelect: () => {
              closeMenu();
              setSelectedTrackId(state.id);
              focusCounter.current += 1;
              setFocusRequest({ trackId: state.id, n: focusCounter.current });
            },
          },
          { id: "move", label: "Déplacer vers…", submenu: targets },
          onSearchMetadata
            ? {
                id: "metadata",
                label: "Rechercher les métadonnées",
                onSelect: () => {
                  closeMenu();
                  onSearchMetadata(state.id);
                },
              }
            : { id: "metadata", label: "Rechercher les métadonnées", disabled: true, title: "Bientôt" },
          {
            id: "delete",
            label: "Supprimer",
            destructive: true,
            onSelect: () => setMenu({ ...state, step: "confirm" }),
          },
        ],
      };
    }

    const count = countFolderItems(folders, tracks, state.id);
    if (state.step === "confirm") {
      return {
        label: "Supprimer le dossier",
        prompt: `Le dossier contient ${itemsLabel(count)}, les remonter dans le parent ?`,
        initialFocusId: "confirm-no",
        items: [
          {
            id: "confirm-yes",
            label: "Oui",
            destructive: true,
            onSelect: () => {
              closeMenu();
              deleteFolder(state.id, true);
            },
          },
          { id: "confirm-no", label: "Non", onSelect: closeMenu },
        ],
      };
    }
    const folder = findFolder(folders, state.id);
    return {
      label: folder ? `Actions pour ${folder.name}` : "Actions du dossier",
      items: [
        {
          id: "rename",
          label: "Renommer",
          onSelect: () => {
            closeMenu();
            setRenamingId(state.id);
          },
        },
        {
          id: "delete",
          label: "Supprimer",
          destructive: true,
          onSelect: () => {
            if (count > 0) {
              setMenu({ ...state, step: "confirm" });
              return;
            }
            closeMenu();
            deleteFolder(state.id, false);
          },
        },
      ],
    };
  };

  const openMenu = menu ? menuItems(menu) : null;

  return (
    <m.div
      role="dialog"
      aria-modal="true"
      aria-label="Administration"
      className="fixed inset-4 flex flex-col overflow-hidden rounded-2xl border border-purple-100/10 bg-purple-950/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] md:inset-8 md:p-6"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.9 }}
    >
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-sm uppercase tracking-widest text-purple-200/70">Administration</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cn(buttonVariants({ variant: "ghost" }))}
            onClick={() => void performLogout()}
          >
            Se déconnecter
          </button>
          <PanelButton label="Fermer l'administration" onClick={onClose}>
            <CloseIcon />
          </PanelButton>
        </div>
      </header>

      {banner && (
        <div
          role="alert"
          className="mt-4 flex items-start justify-between gap-3 rounded-md border border-red-300/20 bg-red-950/30 px-3 py-2 text-sm text-red-100"
        >
          <span className="min-w-0 break-words">{banner}</span>
          <button
            type="button"
            aria-label="Masquer le message"
            className="shrink-0 rounded-sm text-red-100/70 transition-colors hover:text-red-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-red-300/60"
            onClick={() => setBanner(null)}
          >
            <CloseIcon />
          </button>
        </div>
      )}

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto md:flex-row md:overflow-hidden">
        <div className="shrink-0 md:w-64 md:overflow-y-auto">
          <FolderTree
            folders={folders}
            tracks={tracks}
            selectedId={folderId}
            onSelect={selectFolder}
            onDropTrack={moveTrack}
            onFolderMenu={(id, x, y) => setMenu({ kind: "folder", id, x, y, step: "main" })}
            renamingId={renamingId}
            onRename={renameFolder}
            onCancelRename={() => setRenamingId(null)}
            onCreate={createFolder}
            createIntoLabel={folderId ? buildFolderPathLabel(folders, folderId) : undefined}
            firstItemRef={firstItemRef}
          />
        </div>

        <section
          aria-label={buildFolderPathLabel(folders, folderId)}
          className="min-w-0 flex-1 md:overflow-y-auto"
        >
          <TrackTable
            tracks={visibleTracks}
            selectedId={selectedTrack?.id ?? null}
            onSelect={selectTrack}
            onTrackMenu={(id, x, y) => setMenu({ kind: "track", id, x, y, step: "main" })}
          />
        </section>

        <aside className="shrink-0 md:w-80 md:overflow-y-auto">
          {selectedTrack ? (
            <TrackEditor
              key={selectedTrack.id}
              track={selectedTrack}
              folderLabel={buildFolderPathLabel(folders, selectedTrack.folderId)}
              tagsWritten={lastSave?.trackId === selectedTrack.id ? lastSave.tagsWritten : undefined}
              busy={inFlight > 0}
              focusRequest={focusRequest}
              onSave={(patch) => saveTrack(selectedTrack.id, patch)}
              onReplaceCover={(file) =>
                void run(() => adminApi.replaceCover(selectedTrack.id, file))
              }
            />
          ) : (
            <p className="py-6 text-sm text-purple-200/50">Aucun titre sélectionné</p>
          )}
        </aside>
      </div>

      {menu && openMenu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={openMenu.label}
          prompt={openMenu.prompt}
          items={openMenu.items}
          initialFocusId={openMenu.initialFocusId}
          onClose={closeMenu}
        />
      )}
    </m.div>
  );
}

function CloseIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
