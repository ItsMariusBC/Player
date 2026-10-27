// components/admin/metadata-dialog.tsx
// « Rechercher les métadonnées »: a modal layer above the admin panel. The server queries the
// providers and keeps the proposals; applying sends only the proposal id and the cover choice.
// Escape closes this dialog, not the panel behind it (stopped in the capture phase).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { m } from "framer-motion";
import { inputClass } from "@/components/admin/folder-tree";
import { buttonVariants } from "@/components/ui/button";
import * as adminApi from "@/lib/admin-api";
import type { MetadataApplyResult, Proposal } from "@/lib/admin-api";
import {
  METADATA_SEARCH_COOLDOWN_MS,
  isMetadataQueryValid,
  metadataQuery,
  metadataResultsNotice,
  nextMetadataResults,
  proposalDetails,
  type MetadataResults,
} from "@/lib/admin-format";
import { ApiError } from "@/lib/api";
import type { TrackDto } from "@/lib/catalog";
import { cn } from "@/lib/cn";

type SearchStatus = { kind: "idle" } | { kind: "loading" } | { kind: "done" } | { kind: "error"; message: string };

const message = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.code === "proposal_expired"
    ? "Les propositions ont expiré, relancez la recherche"
    : error instanceof Error && error.message
      ? error.message
      : fallback;

const FOCUSABLE =
  "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

export function MetadataDialog({
  track,
  onClose,
  onApplied,
}: {
  track: TrackDto;
  onClose: () => void;
  /** Called after a successful apply; the parent closes the dialog and reloads. */
  onApplied: (result: MetadataApplyResult) => void;
}) {
  const [query, setQuery] = useState(() => metadataQuery(track));
  const [search, setSearch] = useState<SearchStatus>({ kind: "idle" });
  // Kept while a new search runs, and when the server skipped it (rate limit).
  const [results, setResults] = useState<MetadataResults | null>(null);
  const [cooling, setCooling] = useState(false);
  // Read during the first render, before the dialog moves the focus into itself.
  const [returnTarget] = useState(() => document.activeElement as HTMLElement | null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [applyCover, setApplyCover] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [brokenCovers, setBrokenCovers] = useState<ReadonlySet<string>>(() => new Set());
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const coolingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const proposals = results?.proposals ?? [];
  const notice = search.kind === "done" && results ? metadataResultsNotice(results) : null;
  const selected = proposals.find((proposal) => proposal.id === selectedId) ?? null;

  const runSearch = (q: string) => {
    if (!isMetadataQueryValid(q)) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSearch({ kind: "loading" });
    setApplyError(null);
    // The server takes one request per second per provider: a quicker click would be skipped.
    setCooling(true);
    if (coolingTimer.current) clearTimeout(coolingTimer.current);
    coolingTimer.current = setTimeout(() => setCooling(false), METADATA_SEARCH_COOLDOWN_MS);
    adminApi
      .searchMetadata(q.trim(), { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setSearch({ kind: "done" });
        setResults((current) => nextMetadataResults(current?.proposals ?? [], result));
        if (result.skipped) return;
        const first = result.proposals[0];
        setSelectedId(first?.id ?? null);
        setApplyCover(first?.coverUrl != null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResults(null);
        setSelectedId(null);
        setSearch({ kind: "error", message: message(error, "Recherche impossible") });
      });
  };

  // Searches once, on open, with the prefilled query. On close: aborts whatever is in flight
  // and gives the focus back to what had it, else to the track row, else to the panel.
  useEffect(() => {
    const trackId = track.id;
    inputRef.current?.focus();
    runSearch(metadataQuery(track));
    return () => {
      controllerRef.current?.abort();
      if (coolingTimer.current) clearTimeout(coolingTimer.current);
      const target =
        (returnTarget?.isConnected ? returnTarget : null) ??
        document.querySelector<HTMLElement>(`[data-track-id="${CSS.escape(trackId)}"]`) ??
        document.querySelector<HTMLElement>("[data-admin-panel]");
      target?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      // Keeps Tab inside the dialog.
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const select = (proposal: Proposal) => {
    setSelectedId(proposal.id);
    setApplyCover(proposal.coverUrl !== null);
    setApplyError(null);
  };

  const apply = async () => {
    if (!selected || applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      const result = await adminApi.applyMetadata(
        track.id,
        selected.id,
        applyCover && selected.coverUrl !== null,
      );
      onApplied(result);
    } catch (error) {
      setApplyError(message(error, "Application impossible"));
      setApplying(false);
    }
  };

  const showCover = (proposal: Proposal) =>
    proposal.coverUrl !== null && !brokenCovers.has(proposal.id);

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <m.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="metadata-dialog-title"
        className="flex max-h-full w-full max-w-xl flex-col gap-4 overflow-hidden rounded-xl border border-purple-100/10 bg-purple-950/95 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.45)] md:p-6"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15 }}
      >
        <header className="flex items-center justify-between gap-4">
          <h3
            id="metadata-dialog-title"
            className="text-sm uppercase tracking-widest text-purple-200/70"
          >
            Rechercher les métadonnées
          </h3>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "ghost" }), "px-2")}
            onClick={onClose}
          >
            Fermer
          </button>
        </header>

        <form
          role="search"
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            runSearch(query);
          }}
        >
          <input
            ref={inputRef}
            type="search"
            aria-label="Recherche"
            maxLength={200}
            value={query}
            className={inputClass}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="submit"
            disabled={!isMetadataQueryValid(query) || search.kind === "loading" || cooling}
            className={cn(buttonVariants({ variant: "primary" }), "shrink-0 disabled:opacity-50")}
          >
            Rechercher
          </button>
        </form>

        <div className="min-h-24 flex-1 overflow-y-auto" aria-live="polite" aria-busy={search.kind === "loading"}>
          {search.kind === "loading" && (
            <p
              className={cn(
                "text-purple-200/50",
                proposals.length === 0 ? "py-6 text-sm" : "pb-2 text-xs",
              )}
            >
              Recherche…
            </p>
          )}
          {search.kind === "error" && (
            <p role="alert" className="py-6 text-sm text-red-200">
              {search.message}
            </p>
          )}
          {proposals.length > 0 && (
            <fieldset>
              <legend className="sr-only">Propositions</legend>
              <ul className="flex flex-col gap-1">
                {proposals.map((proposal) => (
                  <li key={proposal.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5",
                        "has-focus-visible:ring-2 has-focus-visible:ring-purple-400/60",
                        proposal.id === selectedId ? "bg-purple-200/15" : "hover:bg-purple-200/10",
                      )}
                    >
                      <input
                        type="radio"
                        name="metadata-proposal"
                        className="sr-only"
                        checked={proposal.id === selectedId}
                        onChange={() => select(proposal)}
                      />
                      {showCover(proposal) ? (
                        <img
                          src={proposal.coverUrl ?? undefined}
                          alt=""
                          width={48}
                          height={48}
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          className="size-12 shrink-0 rounded-sm object-cover"
                          onError={() =>
                            setBrokenCovers((current) => new Set(current).add(proposal.id))
                          }
                        />
                      ) : (
                        <span className="size-12 shrink-0 rounded-sm bg-purple-400/10" />
                      )}
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm text-purple-50">{proposal.title}</span>
                        <span className="truncate text-xs text-purple-200/70">
                          {proposal.artist}
                        </span>
                        <span className="truncate text-xs text-purple-200/50">
                          {proposalDetails(proposal)}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {notice && (
            <p
              className={cn(
                "text-purple-200/50",
                proposals.length === 0 ? "py-6 text-sm" : "pt-2 text-xs",
              )}
            >
              {notice}
            </p>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-purple-100">
            <input
              type="checkbox"
              checked={applyCover && selected?.coverUrl != null}
              disabled={!selected || selected.coverUrl === null || applying}
              onChange={(event) => setApplyCover(event.target.checked)}
            />
            Appliquer la pochette
          </label>
          <button
            type="button"
            disabled={!selected || applying}
            className={cn(buttonVariants({ variant: "primary" }), "disabled:opacity-50")}
            onClick={() => void apply()}
          >
            {applying ? "Application…" : "Appliquer"}
          </button>
          {applyError && (
            <p role="alert" className="w-full text-sm text-red-200">
              {applyError}
            </p>
          )}
        </footer>
      </m.div>
    </div>,
    document.body,
  );
}
