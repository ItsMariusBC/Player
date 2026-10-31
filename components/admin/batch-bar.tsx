// components/admin/batch-bar.tsx
// Above the track table while tracks are ticked: move them, set their artist or album, delete
// them (inline confirmation, « Non » focused) or clear the selection. The panel runs each
// action and answers whether it worked, so a field stays open after a failure.
import { useEffect, useRef, useState } from "react";
import type { FolderNode } from "@/lib/catalog";
import { INBOX_LABEL, flattenFolderOptions, selectionLabel } from "@/lib/admin-format";
import { cn } from "@/lib/cn";

type Field = "artist" | "album";

const FIELD_LABEL: Record<Field, string> = { artist: "Artiste", album: "Album" };

const buttonClass =
  "rounded-md border border-purple-100/15 px-2.5 py-1 text-sm text-purple-100 transition-colors hover:border-purple-100/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-300/60 disabled:cursor-not-allowed disabled:opacity-40";

export function BatchBar({
  count,
  folders,
  busy,
  onMove,
  onApply,
  onDelete,
  onClear,
}: {
  count: number;
  folders: FolderNode[];
  busy: boolean;
  /** null: the inbox. */
  onMove: (folderId: string | null) => void;
  onApply: (field: Field, value: string) => Promise<boolean>;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [field, setField] = useState<Field | null>(null);
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (field) fieldRef.current?.focus();
  }, [field]);
  useEffect(() => {
    if (confirming) noRef.current?.focus();
  }, [confirming]);
  // A new selection size is a new question: drop a pending confirmation.
  useEffect(() => setConfirming(false), [count]);

  const toggleField = (next: Field) => {
    setConfirming(false);
    setProblem(null);
    setValue("");
    setField((current) => (current === next ? null : next));
  };

  const submit = async () => {
    if (!field) return;
    const trimmed = value.trim();
    if (field === "artist" && trimmed === "") {
      setProblem("L'artiste ne peut pas être vide");
      return;
    }
    if (await onApply(field, trimmed)) {
      setField(null);
      setValue("");
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Actions sur la sélection"
      className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-purple-100/10 bg-purple-100/5 px-3 py-2 text-sm"
    >
      <span className="text-purple-50">{selectionLabel(count)}</span>
      <select
        aria-label="Déplacer vers…"
        value=""
        disabled={busy}
        className={cn(buttonClass, "bg-transparent")}
        onChange={(event) => {
          const target = event.target.value;
          if (target === "") return;
          setConfirming(false);
          onMove(target === "inbox" ? null : target);
        }}
      >
        <option value="" className="bg-purple-950">
          Déplacer vers…
        </option>
        <option value="inbox" className="bg-purple-950">
          {INBOX_LABEL}
        </option>
        {flattenFolderOptions(folders).map((option) => (
          <option key={option.id} value={option.id} title={option.label} className="bg-purple-950">
            {`${"  ".repeat(option.depth)}${option.name}`}
          </option>
        ))}
      </select>
      {(["artist", "album"] as const).map((key) => (
        <button
          key={key}
          type="button"
          aria-expanded={field === key}
          disabled={busy}
          className={buttonClass}
          onClick={() => toggleField(key)}
        >
          {FIELD_LABEL[key]}…
        </button>
      ))}
      {field && (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            ref={fieldRef}
            value={value}
            aria-label={FIELD_LABEL[field]}
            className="w-40 rounded-md border border-purple-100/15 bg-transparent px-2 py-1 text-purple-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-300/60"
            onChange={(event) => {
              setValue(event.target.value);
              setProblem(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              setField(null);
            }}
          />
          <button type="submit" disabled={busy} className={buttonClass}>
            Appliquer
          </button>
          {problem && (
            <span role="alert" className="text-xs text-red-200">
              {problem}
            </span>
          )}
        </form>
      )}
      {confirming ? (
        <span
          role="group"
          aria-label="Confirmer la suppression"
          className="flex items-center gap-2"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setConfirming(false);
          }}
        >
          <span className="text-purple-50">
            {count === 1 ? "Supprimer 1 titre ?" : `Supprimer ${count} titres ?`}
          </span>
          <button
            type="button"
            disabled={busy}
            className={cn(buttonClass, "border-red-300/30 text-red-100 hover:border-red-300/60")}
            onClick={() => {
              setConfirming(false);
              onDelete();
            }}
          >
            Oui
          </button>
          <button ref={noRef} type="button" className={buttonClass} onClick={() => setConfirming(false)}>
            Non
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          className={cn(buttonClass, "text-red-100")}
          onClick={() => {
            setField(null);
            setConfirming(true);
          }}
        >
          Supprimer
        </button>
      )}
      <button type="button" className={cn(buttonClass, "ml-auto")} onClick={onClear}>
        Désélectionner
      </button>
    </div>
  );
}
