// components/admin/upload-zone.tsx
// Bottom of the panel's centre column: the drop zone (click or Enter opens the file picker)
// and one row per queued file with its progress and server state. Only drags carrying
// files react here; a track row dragged over it is ignored.
import { useRef, useState } from "react";
import type { QueueEntry } from "@/lib/import-queue";
import { cn } from "@/lib/cn";

export const AUDIO_ACCEPT = ".flac,.mp3,.wav,audio/*";

export const hasFiles = (event: { dataTransfer: DataTransfer | null }) =>
  event.dataTransfer?.types.includes("Files") ?? false;

export function UploadZone({
  entries,
  idle,
  labelOf,
  onFiles,
  onShow,
  onClear,
}: {
  entries: QueueEntry[];
  idle: boolean;
  labelOf: (entry: QueueEntry) => string;
  onFiles: (files: File[]) => void;
  /** Selects an imported track in the inbox. */
  onShow: (trackId: string) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // dragenter/dragleave fire for every child crossed: count them.
  const depth = useRef(0);
  const [over, setOver] = useState(false);

  const openPicker = () => inputRef.current?.click();

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Importer des fichiers FLAC, MP3 ou WAV"
        className={cn(
          "cursor-pointer rounded-md border border-dashed border-purple-100/20 px-4 py-5 text-center text-sm text-purple-200/70 transition-colors hover:border-purple-100/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-300/60",
          over && "border-purple-200/60 bg-purple-100/5 text-purple-100",
        )}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          openPicker();
        }}
        onDragEnter={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          depth.current += 1;
          setOver(true);
        }}
        onDragOver={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (!hasFiles(event)) return;
          depth.current = Math.max(depth.current - 1, 0);
          if (depth.current === 0) setOver(false);
        }}
        onDrop={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          depth.current = 0;
          setOver(false);
          onFiles(Array.from(event.dataTransfer.files));
        }}
      >
        Dépose des fichiers FLAC, MP3 ou WAV ici
      </div>
      {/* Outside the zone: its programmatic click must not bubble back into the zone. */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={AUDIO_ACCEPT}
        hidden
        tabIndex={-1}
        onChange={(event) => {
          onFiles(Array.from(event.currentTarget.files ?? []));
          // The same file may be picked again after a failure.
          event.currentTarget.value = "";
        }}
      />

      {entries.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs uppercase tracking-widest text-purple-200/50">Imports</h3>
            {idle && (
              <button
                type="button"
                className="rounded-sm text-xs text-purple-200/70 transition-colors hover:text-purple-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-300/60"
                onClick={onClear}
              >
                Effacer
              </button>
            )}
          </div>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
            {entries.map((entry) => (
              <ImportRow key={entry.key} entry={entry} label={labelOf(entry)} onShow={onShow} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ImportRow({
  entry,
  label,
  onShow,
}: {
  entry: QueueEntry;
  label: string;
  onShow: (trackId: string) => void;
}) {
  const { status } = entry;
  const progress =
    status.kind === "uploading" ? status.progress : status.kind === "pending" ? 0 : null;
  const failed = status.kind === "failed";

  return (
    <li className="flex flex-col gap-1 border-b border-purple-100/10 px-1 py-1.5 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-purple-100" title={entry.filename}>
          {entry.filename}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className={cn("text-xs", failed ? "text-red-200/80" : "text-purple-200/70")}>
            {label}
          </span>
          {status.kind === "ready" && (
            <button
              type="button"
              className="rounded-sm text-xs text-purple-100 underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-300/60"
              aria-label={`Voir ${entry.filename}`}
              onClick={() => onShow(status.trackId)}
            >
              Voir
            </button>
          )}
        </span>
      </div>
      {progress !== null && (
        <div
          role="progressbar"
          aria-label={`Envoi de ${entry.filename}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="h-0.5 overflow-hidden rounded-full bg-purple-100/10"
        >
          <div
            className="h-full bg-purple-200/60 transition-[width] duration-200"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}
    </li>
  );
}
