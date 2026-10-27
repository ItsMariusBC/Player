// components/song-request-dialog.tsx
// « Demander un son »: takes the place of the visualizer and the queue (same footprint,
// styled like the admin panel). Searches the providers like the admin metadata dialog, sends
// the chosen proposal (or the typed title) and lists the user's requests on the right.
// Escape closes it (captured, so nothing behind it reacts).
import { useEffect, useRef, useState } from "react";
import { m } from "framer-motion";
import { CloseIcon } from "@/components/admin/admin-panel";
import { inputClass } from "@/components/admin/folder-tree";
import { PanelButton } from "@/components/visualizer-panel";
import { buttonVariants } from "@/components/ui/button";
import {
  METADATA_SEARCH_COOLDOWN_MS,
  isMetadataQueryValid,
  metadataResultsNotice,
  nextMetadataResults,
  proposalDetails,
  type MetadataResults,
} from "@/lib/admin-format";
import { cn } from "@/lib/cn";
import {
  createRequest,
  listMyRequests,
  searchSongs,
  withdrawRequest,
  type Proposal,
  type SongRequestDto,
} from "@/lib/requests-api";
import { requestDetails, requestErrorMessage, requestStatusDetail } from "@/lib/requests-format";
import { markSeen } from "@/lib/request-badge";

type SearchStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done" }
  | { kind: "error"; message: string };

const FOCUSABLE =
  "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

export interface SongRequestDialogProps {
  onClose: () => void;
  /** True when the track is in the player queue (« Écouter » only shows then). */
  canPlay?: (trackId: string) => boolean;
  /** Starts the track; the dialog closes right after. */
  onPlay?: (trackId: string) => void;
}

export function SongRequestDialog({ onClose, canPlay, onPlay }: SongRequestDialogProps) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchStatus>({ kind: "idle" });
  const [results, setResults] = useState<MetadataResults | null>(null);
  const [cooling, setCooling] = useState(false);
  // StrictMode mounts, cleans up and re-mounts the effect below within the same task: the
  // in-flight calls must only be dropped on the real unmount, so teardown waits a microtask.
  const mountedRef = useRef(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [requests, setRequests] = useState<SongRequestDto[] | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<ReadonlySet<string>>(() => new Set());
  const [brokenCovers, setBrokenCovers] = useState<ReadonlySet<string>>(() => new Set());
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const coolingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const proposals = results?.proposals ?? [];
  const notice = search.kind === "done" && results ? metadataResultsNotice(results) : null;
  const selected = proposals.find((proposal) => proposal.id === selectedId) ?? null;
  const queryValid = isMetadataQueryValid(query);

  const runSearch = (q: string) => {
    if (!isMetadataQueryValid(q)) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSearch({ kind: "loading" });
    setActionError(null);
    setSent(false);
    // The server takes one request per second per provider: a quicker click would be skipped.
    setCooling(true);
    if (coolingTimer.current) clearTimeout(coolingTimer.current);
    coolingTimer.current = setTimeout(() => setCooling(false), METADATA_SEARCH_COOLDOWN_MS);
    searchSongs(q.trim(), { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setSearch({ kind: "done" });
        setResults((current) => nextMetadataResults(current?.proposals ?? [], result));
        if (!result.skipped) setSelectedId(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResults(null);
        setSelectedId(null);
        setSearch({ kind: "error", message: requestErrorMessage(error) });
      });
  };

  // Focuses the field and loads « Mes demandes » once. On close: aborts what is in flight
  // (player.tsx gives the focus back to the opener once it is mounted again).
  useEffect(() => {
    const loadController = new AbortController();
    mountedRef.current = true;
    inputRef.current?.focus();
    markSeen();
    listMyRequests()
      .then((list) => {
        if (!loadController.signal.aborted) setRequests(list);
      })
      .catch((error: unknown) => {
        if (loadController.signal.aborted) return;
        setRequests([]);
        setRequestsError(requestErrorMessage(error));
      });
    return () => {
      mountedRef.current = false;
      loadController.abort();
      queueMicrotask(() => {
        if (mountedRef.current) return;
        controllerRef.current?.abort();
        if (coolingTimer.current) clearTimeout(coolingTimer.current);
      });
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
    setActionError(null);
    setSent(false);
  };

  const send = async () => {
    if (sending || (!selected && !queryValid)) return;
    setSending(true);
    setActionError(null);
    setSent(false);
    try {
      const request = await createRequest(
        selected ? { proposalId: selected.id } : { title: query.trim() },
      );
      setRequests((current) => [request, ...(current ?? [])]);
      setSelectedId(null);
      setQuery("");
      setSent(true);
    } catch (error) {
      setActionError(requestErrorMessage(error));
    } finally {
      setSending(false);
    }
  };

  const withdraw = async (request: SongRequestDto) => {
    if (withdrawing.has(request.id)) return;
    setWithdrawing((current) => new Set(current).add(request.id));
    setActionError(null);
    try {
      await withdrawRequest(request.id);
      setRequests((current) => current?.filter((item) => item.id !== request.id) ?? null);
    } catch (error) {
      // The request may be gone or already handled: show the real state next to the error.
      try {
        setRequests(await listMyRequests());
      } catch {
        // Keep the list as it is; the error below is the one that matters.
      }
      setActionError(requestErrorMessage(error));
    } finally {
      setWithdrawing((current) => {
        const next = new Set(current);
        next.delete(request.id);
        return next;
      });
    }
  };

  const showCover = (proposal: Proposal) =>
    proposal.coverUrl !== null && !brokenCovers.has(proposal.id);

  return (
    <m.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Demander un son"
      data-request-panel=""
      tabIndex={-1}
      className="flex max-h-[80svh] w-full flex-col focus:outline-hidden overflow-hidden rounded-2xl border border-purple-100/10 bg-purple-950/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] md:h-[500px] md:p-6"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.9 }}
    >
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-sm uppercase tracking-widest text-purple-200/70">Demander un son</h2>
        <PanelButton label="Fermer la demande" onClick={onClose}>
          <CloseIcon />
        </PanelButton>
      </header>

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto md:flex-row md:overflow-hidden">
        <section aria-label="Recherche d'un titre" className="flex min-w-0 flex-1 flex-col gap-4 md:overflow-hidden">
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (search.kind !== "loading" && !cooling) runSearch(query);
          }}
        >
          <input
            ref={inputRef}
            type="search"
            aria-label="Recherche"
            maxLength={200}
            value={query}
            className={inputClass}
            onChange={(event) => {
              // Typing a new title drops the proposal, so « Demander » sends what is typed.
              setQuery(event.target.value);
              setSelectedId(null);
            }}
          />
          <button
            type="submit"
            disabled={!queryValid || search.kind === "loading" || cooling}
            className={cn(buttonVariants({ variant: "primary" }), "shrink-0 disabled:opacity-50")}
          >
            Rechercher
          </button>
        </form>

        <div className="min-h-0 flex-1 md:overflow-y-auto">
            <div aria-live="polite" aria-busy={search.kind === "loading"}>
            {search.kind === "loading" && (
              <p
                className={cn(
                  "text-purple-200/50",
                  proposals.length === 0 ? "py-4 text-sm" : "pb-2 text-xs",
                )}
              >
                Recherche…
              </p>
            )}
            {search.kind === "error" && (
              <p role="alert" className="py-4 text-sm text-red-200">
                {search.message}
              </p>
            )}
            </div>
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
                          name="song-request-proposal"
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
            <div aria-live="polite">
              {notice && (
                <p
                  className={cn(
                    "text-purple-200/50",
                    proposals.length === 0 ? "py-4 text-sm" : "pt-2 text-xs",
                  )}
                >
                  {notice}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={sending || (!selected && !queryValid)}
              className={cn(buttonVariants({ variant: "primary" }), "disabled:opacity-50")}
              onClick={() => void send()}
            >
              {sending ? "Envoi…" : "Demander"}
            </button>
            {sent && (
              <p role="status" className="text-sm text-purple-100">
                Demande envoyée
              </p>
            )}
            {actionError && (
              <p role="alert" className="w-full text-sm text-red-200">
                {actionError}
              </p>
            )}
          </div>
        </section>

        <aside aria-labelledby="song-request-mine" className="flex shrink-0 flex-col gap-2 md:w-80 md:overflow-y-auto">
            <h3
              id="song-request-mine"
              className="text-xs uppercase tracking-widest text-purple-200/70"
            >
              Mes demandes
            </h3>
            {requestsError && (
              <p role="alert" className="text-sm text-red-200">
                {requestsError}
              </p>
            )}
            {requests !== null && requests.length === 0 && !requestsError && (
              <p className="text-sm text-purple-200/50">Aucune demande</p>
            )}
            {requests !== null && requests.length > 0 && (
              <ul className="flex flex-col gap-1">
                {requests.map((request) => {
                  const details = requestDetails(request);
                  return (
                    <li
                      key={request.id}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm text-purple-50">{request.title}</span>
                        {request.artist && (
                          <span className="truncate text-xs text-purple-200/70">
                            {request.artist}
                          </span>
                        )}
                        {details && (
                          <span className="truncate text-xs text-purple-200/50">{details}</span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-purple-200/70">
                          {requestStatusDetail(request)}
                        </span>
                        {request.status === "added" &&
                          request.trackId &&
                          onPlay &&
                          canPlay?.(request.trackId) && (
                            <button
                              type="button"
                              className={cn(buttonVariants({ variant: "ghost" }), "px-2")}
                              onClick={() => {
                                onPlay(request.trackId as string);
                                onClose();
                              }}
                            >
                              Écouter
                            </button>
                          )}
                        {request.status === "pending" && (
                          <button
                            type="button"
                            disabled={withdrawing.has(request.id)}
                            className={cn(
                              buttonVariants({ variant: "ghost" }),
                              "px-2 disabled:opacity-50",
                            )}
                            onClick={() => void withdraw(request)}
                          >
                            Retirer
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
        </aside>
      </div>
    </m.div>
  );
}
