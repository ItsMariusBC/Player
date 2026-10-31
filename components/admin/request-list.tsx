// components/admin/request-list.tsx
// « Demandes » view of the admin panel: pending requests first, then accepted ones. « Valider »
// accepts a pending request; « Supprimer » switches the row to an inline confirmation whose
// « Non » is focused by default.
import { useEffect, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { AdminSongRequestDto } from "@/lib/requests-api";
import { requestDetails, requestStatusDetail } from "@/lib/requests-format";
import { inputClass } from "@/components/admin/folder-tree";
import { cn } from "@/lib/cn";

export interface RequestListProps {
  requests: AdminSongRequestDto[];
  busy: boolean;
  onAccept: (request: AdminSongRequestDto) => void;
  onDelete: (request: AdminSongRequestDto) => void;
  onImport: (request: AdminSongRequestDto) => void;
  onReject: (request: AdminSongRequestDto, reason: string) => void;
  onShowTrack: (request: AdminSongRequestDto) => void;
}

const actionClass = cn(buttonVariants({ variant: "ghost" }), "disabled:opacity-50");

export function RequestList({
  requests,
  busy,
  onAccept,
  onDelete,
  onImport,
  onReject,
  onShowTrack,
}: RequestListProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  if (requests.length === 0) {
    return <p className="py-6 text-sm text-purple-200/50">Aucune demande</p>;
  }

  return (
    <ul className="flex flex-col">
      {requests.map((request) => (
        <RequestRow
          key={request.id}
          request={request}
          busy={busy}
          confirming={confirmingId === request.id}
          rejecting={rejectingId === request.id}
          onAskReject={() => setRejectingId(request.id)}
          onCancelReject={() => setRejectingId(null)}
          onReject={(reason) => {
            setRejectingId(null);
            onReject(request, reason);
          }}
          onImport={() => onImport(request)}
          onShowTrack={() => onShowTrack(request)}
          onAskDelete={() => setConfirmingId(request.id)}
          onCancelDelete={() => setConfirmingId(null)}
          onAccept={() => onAccept(request)}
          onDelete={() => {
            setConfirmingId(null);
            onDelete(request);
          }}
        />
      ))}
    </ul>
  );
}

function RequestRow({
  request,
  busy,
  confirming,
  rejecting,
  onAskReject,
  onCancelReject,
  onReject,
  onImport,
  onShowTrack,
  onAskDelete,
  onCancelDelete,
  onAccept,
  onDelete,
}: {
  request: AdminSongRequestDto;
  busy: boolean;
  confirming: boolean;
  rejecting: boolean;
  onAskReject: () => void;
  onCancelReject: () => void;
  onReject: (reason: string) => void;
  onImport: () => void;
  onShowTrack: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onAccept: () => void;
  onDelete: () => void;
}) {
  const [coverFailed, setCoverFailed] = useState(false);
  const noRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (rejecting) reasonRef.current?.focus();
    else setReason("");
  }, [rejecting]);
  useEffect(() => {
    if (confirming) noRef.current?.focus();
  }, [confirming]);

  // Leaving the reject form or the delete confirm returns the focus to the button that opened it.
  const rejectButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const focusBack = useRef<"reject" | "delete" | null>(null);
  useEffect(() => {
    if (rejecting || confirming || !focusBack.current) return;
    const target = focusBack.current === "reject" ? rejectButtonRef : deleteButtonRef;
    focusBack.current = null;
    target.current?.focus();
  }, [rejecting, confirming]);
  const closeReject = () => {
    focusBack.current = "reject";
    onCancelReject();
  };
  const submitReject = (value: string) => {
    focusBack.current = "reject";
    onReject(value);
  };
  const closeDelete = () => {
    focusBack.current = "delete";
    onCancelDelete();
  };
  const submitDelete = () => {
    focusBack.current = "delete";
    onDelete();
  };

  const details = requestDetails(request);
  const author = request.requestedBy.displayName || "utilisateur inconnu";
  const date = new Date(request.createdAt).toLocaleDateString("fr-FR");

  return (
    <li
      data-request-id={request.id}
      className="flex flex-wrap items-center gap-3 border-b border-purple-100/5 px-2 py-2"
    >
      <div className="size-12 shrink-0 overflow-hidden rounded-sm bg-purple-200/10">
        {request.coverUrl && !coverFailed && (
          <img
            src={request.coverUrl}
            alt=""
            width={48}
            height={48}
            referrerPolicy="no-referrer"
            className="size-12 object-cover"
            onError={() => setCoverFailed(true)}
          />
        )}
      </div>
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm text-purple-50">{request.title}</p>
        {request.artist && <p className="truncate text-sm text-purple-200/70">{request.artist}</p>}
        {details && <p className="truncate text-xs text-purple-200/50">{details}</p>}
        <p className="truncate text-xs text-purple-200/50">
          demandé par {author} · {date}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full border px-2 py-0.5 text-xs",
          request.status === "pending"
            ? "border-purple-300/30 text-purple-100"
            : "border-purple-100/10 text-purple-200/60",
        )}
      >
        {requestStatusDetail(request)}
      </span>
      {confirming ? (
        <div
          role="group"
          aria-label="Confirmer la suppression"
          className="flex shrink-0 items-center gap-1"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // Cancels the confirmation only; the panel stays open.
              event.preventDefault();
              event.stopPropagation();
              event.nativeEvent.stopImmediatePropagation();
              closeDelete();
            }
          }}
        >
          <span className="text-sm text-purple-100">Supprimer définitivement ?</span>
          <button
            type="button"
            disabled={busy}
            className={cn(actionClass, "text-red-200 hover:bg-red-500/20")}
            onClick={submitDelete}
          >
            Oui
          </button>
          <button
            ref={noRef}
            type="button"
            className={actionClass}
            onClick={closeDelete}
          >
            Non
          </button>
        </div>
      ) : rejecting ? (
        <div
          role="group"
          aria-label="Refuser la demande"
          className="flex shrink-0 items-center gap-1"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              event.nativeEvent.stopImmediatePropagation();
              closeReject();
            }
          }}
        >
          <input
            ref={reasonRef}
            type="text"
            value={reason}
            maxLength={200}
            aria-label="Motif (facultatif)"
            placeholder="Motif (facultatif)"
            className={inputClass}
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !busy) submitReject(reason.trim());
            }}
          />
          <button
            type="button"
            disabled={busy}
            className={actionClass}
            onClick={() => submitReject(reason.trim())}
          >
            Confirmer
          </button>
          <button type="button" className={actionClass} onClick={closeReject}>
            Annuler
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          {(request.status === "pending" || request.status === "accepted") && (
            <button type="button" disabled={busy} className={actionClass} onClick={onImport}>
              Importer
            </button>
          )}
          {request.status === "pending" && (
            <button type="button" disabled={busy} className={actionClass} onClick={onAccept}>
              Valider
            </button>
          )}
          {(request.status === "pending" || request.status === "accepted") && (
            <button
              ref={rejectButtonRef}
              type="button"
              disabled={busy}
              className={actionClass}
              onClick={onAskReject}
            >
              Refuser
            </button>
          )}
          {request.status === "added" && request.trackId && (
            <button type="button" className={actionClass} onClick={onShowTrack}>
              Voir le titre
            </button>
          )}
          <button
            ref={deleteButtonRef}
            type="button"
            disabled={busy}
            className={cn(actionClass, "text-red-200 hover:bg-red-500/20")}
            onClick={onAskDelete}
          >
            Supprimer
          </button>
        </div>
      )}
    </li>
  );
}
