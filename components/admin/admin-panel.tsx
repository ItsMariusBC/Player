// components/admin/admin-panel.tsx
// Admin panel, sized and styled like the expanded visualizer (the page unmounts the rest of
// the UI while it is shown). Folders on the left, the tracks of the selected folder in the
// centre with the import drop zone below them, the tag editor on the right, the metadata
// dialog above. Every mutation goes through lib/admin-api, then reloads the admin catalogue
// and the player's one; a failure shows in the banner.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { m } from "framer-motion";
import { PanelButton } from "@/components/visualizer-panel";
import { buttonVariants } from "@/components/ui/button";
import { BatchBar } from "@/components/admin/batch-bar";
import { ContextMenu, type MenuItem } from "@/components/admin/context-menu";
import { FolderTree } from "@/components/admin/folder-tree";
import { RequestList } from "@/components/admin/request-list";
import { MetadataDialog } from "@/components/admin/metadata-dialog";
import { TrackEditor } from "@/components/admin/track-editor";
import { LoudnessStatus } from "@/components/admin/loudness-status";
import { SystemStatus } from "@/components/admin/system-status";
import { TrackTable } from "@/components/admin/track-table";
import { UploadZone, hasFiles } from "@/components/admin/upload-zone";
import type { CollectResult, DroppedFile } from "@/lib/drop-entries";
import * as adminApi from "@/lib/admin-api";
import {
  BATCH_MAX,
  INBOX_LABEL,
  batchResultLabel,
  buildFolderPathLabel,
  countFolderItems,
  findFolder,
  flattenFolderOptions,
  tracksInFolder,
} from "@/lib/admin-format";
import { performLogout } from "@/lib/api";
import { useAdminCatalog } from "@/lib/hooks/use-admin-catalog";
import { useAdminRequests } from "@/lib/hooks/use-admin-requests";
import { useImportQueue } from "@/lib/hooks/use-import-queue";
import { acceptRequest, deleteRequest, rejectRequest, type AdminSongRequestDto } from "@/lib/requests-api";
import { entryLabel } from "@/lib/import-queue";
import { cn } from "@/lib/cn";

type MenuState =
  | { kind: "track"; id: string; x: number; y: number; step: "main" | "confirm" }
  | { kind: "folder"; id: string; x: number; y: number; step: "main" | "confirm" };

const GENERIC_ERROR = "Action impossible";

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : GENERIC_ERROR;

const SELECTION_LIMIT_NOTICE = `Sélection limitée à ${BATCH_MAX} titres`;

const itemsLabel = (count: number) => (count === 1 ? "1 élément" : `${count} éléments`);

export interface AdminPanelProps {
  onClose: () => void;
  /** Reloads the player's catalogue (useCatalog().refresh). */
  onCatalogChanged: () => Promise<void> | void;
}

export function AdminPanel({ onClose, onCatalogChanged }: AdminPanelProps) {
  // Errors and batch results share one dismissible banner; only the styling differs.
  const [banner, setBanner] = useState<{ text: string; tone: "error" | "notice" } | null>(null);
  const showError = useCallback((error: unknown) => {
    console.error("Admin action failed", error);
    setBanner({ text: errorMessage(error), tone: "error" });
  }, []);
  const { catalog, refreshAdmin } = useAdminCatalog(showError);
  const { requests, pending, refresh: refreshRequests } = useAdminRequests(showError);
  const [view, setView] = useState<"catalog" | "requests">("catalog");
  const folders = catalog?.folders ?? [];
  const tracks = catalog?.tracks ?? [];

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  // Tracks ticked for a batch action; emptied when the displayed folder changes.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const lastToggled = useRef<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // Runs in flight (a drag-move may overlap a save): the editor is disabled while any is.
  const [inFlight, setInFlight] = useState(0);
  const [lastSave, setLastSave] = useState<{ trackId: string; tagsWritten: boolean } | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ trackId: string; n: number } | null>(null);
  const [metadataTrackId, setMetadataTrackId] = useState<string | null>(null);
  // Bumped after a metadata apply so the editor remounts with the new tags.
  const [editorEpoch, setEditorEpoch] = useState(0);
  // Never reset, so a new request is always newer than any the editor already honoured.
  const focusCounter = useRef(0);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  // A folder or track that disappeared (deleted, moved by someone else) falls back cleanly.
  const folderId =
    selectedFolderId !== null && findFolder(folders, selectedFolderId) ? selectedFolderId : null;
  const visibleTracks = tracksInFolder(folders, tracks, folderId);
  const selectedIds = useMemo(
    () => new Set(visibleTracks.filter((track) => ticked.has(track.id)).map((track) => track.id)),
    [visibleTracks, ticked],
  );
  const selectedTrack = tracks.find((track) => track.id === selectedTrackId);
  const metadataTrack = tracks.find((track) => track.id === metadataTrackId);

  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  // Without the limit, files go to the server unchecked and a 413 still reads « Trop volumineux ».
  const [maxUploadBytes, setMaxUploadBytes] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    adminApi
      .getLimits()
      .then(({ maxUploadBytes: limit }) => {
        if (active) setMaxUploadBytes(limit);
      })
      .catch((error: unknown) => {
        if (active) showError(error);
      });
    return () => {
      active = false;
    };
  }, [showError]);

  // The admin catalogue first (the fulfilled request's track must exist), then the requests.
  const onImported = useCallback(() => {
    void (async () => {
      try {
        await Promise.all([refreshAdmin(), onCatalogChanged()]);
      } catch (error) {
        showError(error);
      }
      try {
        await refreshRequests();
      } catch (error) {
        showError(error);
      }
    })();
  }, [refreshAdmin, onCatalogChanged, refreshRequests, showError]);
  const getFolders = useCallback(() => folders, [folders]);
  const imports = useImportQueue({
    maxUploadBytes,
    onReady: onImported,
    getFolders,
    onError: showError,
  });

  useEffect(() => {
    setTicked(new Set());
    lastToggled.current = null;
  }, [folderId]);

  const onFolderFiles = (result: CollectResult) => {
    if (result.tooMany) {
      showError(new Error("Trop de fichiers (500 max)"));
      return;
    }
    if (result.files.length === 0) {
      setBanner({ text: "Aucun fichier audio trouvé", tone: "notice" });
      return;
    }
    void imports.addEntries(result.files as DroppedFile<File>[], folderId);
  };

  // A file dropped beside the zone must not replace the app with the audio file.
  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event) || event.defaultPrevented) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    };
    const onDrop = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
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

  // Request actions only touch the requests list: it is reloaded even when the action fails
  // (the request may be gone or already handled), and the catalogues stay as they are.
  const runRequestAction = useCallback(
    async (action: () => Promise<unknown>) => {
      setInFlight((n) => n + 1);
      try {
        await action();
      } catch (error) {
        showError(error);
      } finally {
        await refreshRequests();
        setInFlight((n) => n - 1);
      }
    },
    [refreshRequests, showError],
  );

  const acceptOne = (requestId: string) => void runRequestAction(() => acceptRequest(requestId));

  const rejectOne = (requestId: string, reason: string) =>
    void runRequestAction(() => rejectRequest(requestId, reason || undefined));

  // « Importer » stores the request, then opens the panel's own picker; the chosen file goes
  // out with the request and the current folder, and the import queue (catalogue tab) shows it.
  const importInputRef = useRef<HTMLInputElement>(null);
  const importRequestRef = useRef<AdminSongRequestDto | null>(null);
  const startImport = (request: AdminSongRequestDto) => {
    importRequestRef.current = request;
    importInputRef.current?.click();
  };
  const onImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    const request = importRequestRef.current;
    importRequestRef.current = null;
    input.value = "";
    if (!file || !request) return;
    imports.addFiles([file], { folderId, requestId: request.id, requestTitle: request.title });
    setView("catalog");
  };

  const showRequestTrack = async (request: AdminSongRequestDto) => {
    const trackId = request.trackId;
    let track = trackId ? tracks.find((t) => t.id === trackId) : undefined;
    if (!track && trackId) {
      try {
        const fresh = await refreshAdmin();
        track = fresh.tracks.find((t) => t.id === trackId);
      } catch (error) {
        showError(error);
        return;
      }
    }
    if (!track) {
      setBanner({ text: "Titre introuvable", tone: "notice" });
      return;
    }
    setView("catalog");
    selectFolder(track.folderId);
    selectTrack(track.id);
  };

  const deleteOne = (requestId: string) => void runRequestAction(() => deleteRequest(requestId));

  // The list may have changed since the last visit (new requests from the player).
  useEffect(() => {
    if (view === "requests") void refreshRequests();
  }, [view, refreshRequests]);

  const toggleTrack = (id: string, shiftKey: boolean) => {
    const next = new Set(selectedIds);
    let limited = false;
    const add = (trackId: string) => {
      if (next.has(trackId)) return;
      if (next.size >= BATCH_MAX) limited = true;
      else next.add(trackId);
    };
    const from = lastToggled.current;
    const fromIndex = from === null ? -1 : visibleTracks.findIndex((t) => t.id === from);
    const toIndex = visibleTracks.findIndex((t) => t.id === id);
    if (shiftKey && fromIndex >= 0 && toIndex >= 0) {
      // The range takes the state of the box that was just clicked.
      const on = !selectedIds.has(id);
      const [lo, hi] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
      for (const track of visibleTracks.slice(lo, hi + 1)) {
        if (on) add(track.id);
        else next.delete(track.id);
      }
    } else if (next.has(id)) next.delete(id);
    else add(id);
    lastToggled.current = id;
    setTicked(next);
    if (limited) setBanner({ text: SELECTION_LIMIT_NOTICE, tone: "notice" });
  };

  const toggleAll = () => {
    lastToggled.current = null;
    const cap = Math.min(visibleTracks.length, BATCH_MAX);
    if (selectedIds.size >= cap) {
      setTicked(new Set());
      return;
    }
    setTicked(new Set(visibleTracks.slice(0, BATCH_MAX).map((track) => track.id)));
    if (visibleTracks.length > BATCH_MAX) {
      setBanner({ text: SELECTION_LIMIT_NOTICE, tone: "notice" });
    }
  };

  const clearSelection = () => {
    setTicked(new Set());
    lastToggled.current = null;
  };

  const batchUpdate = async (patch: adminApi.BatchTrackPatch) => {
    let failedIds: string[] = [];
    const ok = await run(async () => {
      const result = await adminApi.batchUpdateTracks([...selectedIds], patch);
      failedIds = result.failed ?? [];
      setBanner({
        text: batchResultLabel({
          updated: result.updated.length,
          missing: result.missing.length,
          failed: failedIds.length,
        }),
        tone: "notice",
      });
    });
    if (!ok) return ok;
    // Tracks that failed stay ticked so the action can be retried on them.
    if (failedIds.length > 0) setTicked(new Set(failedIds));
    else clearSelection();
    return ok;
  };

  const batchDelete = async () => {
    const ok = await run(async () => {
      const result = await adminApi.batchDeleteTracks([...selectedIds]);
      setSelectedTrackId((current) => (current !== null && result.deleted.includes(current) ? null : current));
      setBanner({
        text: batchResultLabel({ deleted: result.deleted.length, missing: result.missing.length }),
        tone: "notice",
      });
    });
    if (ok) clearSelection();
  };

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

  const onSearchMetadata = (trackId: string) => {
    setSelectedTrackId(trackId);
    setFocusRequest(null);
    setMetadataTrackId(trackId);
  };

  const closeMetadata = useCallback(() => setMetadataTrackId(null), []);

  const onMetadataApplied = (trackId: string, result: adminApi.MetadataApplyResult) => {
    setMetadataTrackId(null);
    setLastSave({ trackId, tagsWritten: result.tagsWritten });
    if (result.coverError) {
      setBanner({
        text: "Tags appliqués, mais la pochette proposée a été refusée",
        tone: "error",
      });
    }
    setInFlight((n) => n + 1);
    Promise.all([refreshAdmin(), onCatalogChanged()])
      .then(() => setEditorEpoch((n) => n + 1))
      .catch(showError)
      .finally(() => setInFlight((n) => n - 1));
  };

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
          {
            id: "metadata",
            label: "Rechercher les métadonnées",
            onSelect: () => {
              closeMenu();
              onSearchMetadata(state.id);
            },
          },
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
      data-admin-panel=""
      tabIndex={-1}
      className="fixed inset-4 flex flex-col focus:outline-hidden overflow-hidden rounded-2xl border border-purple-100/10 bg-purple-950/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] md:inset-8 md:p-6"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.9 }}
    >
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <div
            role="tablist"
            aria-label="Vue"
            className="flex items-center gap-4"
            onKeyDown={(event) => {
              const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
              if (!keys.includes(event.key)) return;
              event.preventDefault();
              let next: "catalog" | "requests";
              if (event.key === "Home") next = "catalog";
              else if (event.key === "End") next = "requests";
              else next = view === "catalog" ? "requests" : "catalog";
              setView(next);
              document.getElementById(`admin-tab-${next}`)?.focus();
            }}
          >
            {(
              [
                ["catalog", "Catalogue"],
                ["requests", `Demandes (${pending})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                id={`admin-tab-${key}`}
                type="button"
                role="tab"
                aria-selected={view === key}
                aria-controls={`admin-panel-${key}`}
                tabIndex={view === key ? 0 : -1}
                className={cn(
                  "border-b-2 py-1 text-sm uppercase tracking-widest transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-400/60",
                  view === key
                    ? "border-purple-200 text-purple-50"
                    : "border-transparent text-purple-200/50 hover:text-purple-100",
                )}
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
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
          role={banner.tone === "error" ? "alert" : "status"}
          className={cn(
            "mt-4 flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm",
            banner.tone === "error"
              ? "border-red-300/20 bg-red-950/30 text-red-100"
              : "border-purple-200/20 bg-purple-100/10 text-purple-50",
          )}
        >
          <span className="min-w-0 break-words">{banner.text}</span>
          <button
            type="button"
            aria-label="Masquer le message"
            className={cn(
              "shrink-0 rounded-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2",
              banner.tone === "error"
                ? "text-red-100/70 hover:text-red-50 focus-visible:ring-red-300/60"
                : "text-purple-100/70 hover:text-purple-50 focus-visible:ring-purple-300/60",
            )}
            onClick={() => setBanner(null)}
          >
            <CloseIcon />
          </button>
        </div>
      )}

      <input
        ref={importInputRef}
        type="file"
        accept=".flac,.mp3,.wav"
        hidden
        data-request-import-input=""
        onChange={onImportFile}
      />

      {view === "requests" && (
        <div
          role="tabpanel"
          id="admin-panel-requests"
          aria-labelledby="admin-tab-requests"
          className="mt-4 min-h-0 flex-1 overflow-y-auto"
        >
          <RequestList
            requests={requests}
            busy={inFlight > 0}
            onAccept={(request) => acceptOne(request.id)}
            onDelete={(request) => deleteOne(request.id)}
            onImport={startImport}
            onReject={(request, reason) => rejectOne(request.id, reason)}
            onShowTrack={(request) => void showRequestTrack(request)}
          />
        </div>
      )}

      <div
        role="tabpanel"
        id="admin-panel-catalog"
        aria-labelledby="admin-tab-catalog"
        className={cn(
          "mt-4 min-h-0 flex-1 flex-col gap-6 overflow-y-auto md:flex-row md:overflow-hidden",
          view === "catalog" ? "flex" : "hidden",
        )}
      >
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
          className="flex min-w-0 flex-1 flex-col gap-4 md:overflow-hidden"
        >
          <div className="min-h-0 flex-1 md:overflow-y-auto">
            {selectedIds.size > 0 && (
              <BatchBar
                count={selectedIds.size}
                folders={folders}
                busy={inFlight > 0}
                onMove={(target) => void batchUpdate({ folderId: target })}
                onApply={(field, value) => batchUpdate({ [field]: value })}
                onDelete={() => void batchDelete()}
                onClear={clearSelection}
              />
            )}
            <TrackTable
              tracks={visibleTracks}
              selectedId={selectedTrack?.id ?? null}
              selectedIds={selectedIds}
              onSelect={selectTrack}
              onToggle={toggleTrack}
              onToggleAll={toggleAll}
              onTrackMenu={(id, x, y) => setMenu({ kind: "track", id, x, y, step: "main" })}
            />
          </div>
          <div className="shrink-0">
            <LoudnessStatus onError={showError} />
          </div>
          <div className="shrink-0">
            <SystemStatus onError={showError} />
          </div>
          <div className="shrink-0">
            <UploadZone
              entries={imports.entries}
              idle={imports.idle}
              labelOf={(entry) =>
                entryLabel(entry, {
                  maxUploadBytes,
                  titleOf: (id) => tracks.find((track) => track.id === id)?.title,
                })
              }
              onFiles={(files) => imports.addFiles(files, { folderId })}
              onFolder={onFolderFiles}
              onUrl={(url) => imports.addUrl(url, folderId)}
              onShow={(trackId) => {
                selectFolder(null);
                selectTrack(trackId);
              }}
              onClear={imports.clear}
            />
          </div>
        </section>

        <aside className="shrink-0 md:w-80 md:overflow-y-auto">
          {selectedTrack ? (
            <TrackEditor
              key={`${selectedTrack.id}:${editorEpoch}`}
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

      {metadataTrack && (
        <MetadataDialog
          track={metadataTrack}
          onClose={closeMetadata}
          onApplied={(result) => onMetadataApplied(metadataTrack.id, result)}
        />
      )}

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

export function CloseIcon() {
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
