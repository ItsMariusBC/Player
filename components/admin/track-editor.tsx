// components/admin/track-editor.tsx
// Right column of the admin panel: tags and cover of the selected track. The parent keys
// it by track id, so the fields reset when another track is selected.
import { useEffect, useRef, useState } from "react";
import type { TrackPatch } from "@/lib/admin-api";
import { type TrackDto, coverUrl } from "@/lib/catalog";
import { inputClass } from "@/components/admin/folder-tree";
import { tagsStatusLabel } from "@/lib/admin-format";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const labelClass = "text-xs uppercase tracking-widest text-purple-200/50";

export function TrackEditor({
  track,
  folderLabel,
  tagsWritten,
  busy,
  focusRequest,
  onSave,
  onReplaceCover,
}: {
  track: TrackDto;
  /** Where the track lives, e.g. "Rock / Live" or « Boîte d'arrivée ». */
  folderLabel: string;
  /** Outcome of the last save of this track, undefined before any save. */
  tagsWritten?: boolean;
  busy: boolean;
  /**
   * Set by « Modifier »: the title field takes the focus when the token names this track
   * and is newer than the last one honoured (so a remount for another track never steals it).
   */
  focusRequest: { trackId: string; n: number } | null;
  onSave: (patch: TrackPatch) => void;
  onReplaceCover: (file: File) => void;
}) {
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [album, setAlbum] = useState(track.album);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const honoured = useRef(0);

  useEffect(() => {
    if (!focusRequest || focusRequest.trackId !== track.id) return;
    if (focusRequest.n <= honoured.current) return;
    honoured.current = focusRequest.n;
    titleRef.current?.focus();
  }, [focusRequest, track.id]);

  // Only the changed fields are sent; an unchanged form has nothing to save.
  const patch: TrackPatch = {};
  if (title.trim() !== track.title) patch.title = title.trim();
  if (artist.trim() !== track.artist) patch.artist = artist.trim();
  if (album.trim() !== track.album) patch.album = album.trim();
  const dirty = Object.keys(patch).length > 0;
  const valid = title.trim() !== "";

  return (
    <form
      aria-label="Modifier le titre"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && valid && !busy) onSave(patch);
      }}
    >
      <div className="flex flex-col gap-3">
        {track.hasCover ? (
          <img
            src={coverUrl(track.id, track.updatedAt)}
            alt=""
            width={160}
            height={160}
            decoding="async"
            className="size-40 rounded-md object-cover"
          />
        ) : (
          <div className="size-40 rounded-md bg-purple-400/10" />
        )}
        <button
          type="button"
          disabled={busy}
          className={cn(buttonVariants({ variant: "ghost" }), "self-start px-2 disabled:opacity-50")}
          onClick={() => fileRef.current?.click()}
        >
          Remplacer la pochette
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset so choosing the same file again still fires a change.
            event.target.value = "";
            if (file) onReplaceCover(file);
          }}
        />
      </div>

      <span className={labelClass}>{folderLabel}</span>

      <Field label="Titre">
        <input
          ref={titleRef}
          required
          maxLength={200}
          value={title}
          className={inputClass}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field label="Artiste">
        <input
          maxLength={200}
          value={artist}
          className={inputClass}
          onChange={(event) => setArtist(event.target.value)}
        />
      </Field>
      <Field label="Album">
        <input
          maxLength={200}
          value={album}
          className={inputClass}
          onChange={(event) => setAlbum(event.target.value)}
        />
      </Field>

      <div className="flex flex-col items-start gap-2">
        <button
          type="submit"
          disabled={!dirty || !valid || busy}
          className={cn(buttonVariants({ variant: "primary" }), "disabled:opacity-50")}
        >
          Enregistrer
        </button>
        {tagsWritten !== undefined && (
          <span role="status" className="text-xs text-purple-200/60">
            {tagsStatusLabel(tagsWritten, track.format)}
          </span>
        )}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}
