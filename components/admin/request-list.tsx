// components/admin/request-list.tsx
// « Demandes » view of the admin panel: pending requests first, then accepted ones. « Valider »
// accepts a pending request; « Supprimer » switches the row to an inline confirmation whose
// « Non » is focused by default.
import { useEffect, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { AdminSongRequestDto } from "@/lib/requests-api";
import { requestDetails, requestStatusLabel } from "@/lib/requests-format";
import { cn } from "@/lib/cn";

export interface RequestListProps {
  requests: AdminSongRequestDto[];
  busy: boolean;
  onAccept: (request: AdminSongRequestDto) => void;
  onDelete: (request: AdminSongRequestDto) => void;
}

const actionClass = cn(buttonVariants({ variant: "ghost" }), "disabled:opacity-50");

export function RequestList({ requests, busy, onAccept, onDelete }: RequestListProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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
  onAskDelete,
  onCancelDelete,
  onAccept,
  onDelete,
}: {
  request: AdminSongRequestDto;
  busy: boolean;
  confirming: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onAccept: () => void;
  onDelete: () => void;
}) {
  const [coverFailed, setCoverFailed] = useState(false);
  const noRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) noRef.current?.focus();
  }, [confirming]);

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
        {requestStatusLabel(request.status)}
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
              onCancelDelete();
            }
          }}
        >
          <span className="text-sm text-purple-100">Supprimer définitivement ?</span>
          <button
            type="button"
            disabled={busy}
            className={cn(actionClass, "text-red-200 hover:bg-red-500/20")}
            onClick={onDelete}
          >
            Oui
          </button>
          <button
            ref={noRef}
            type="button"
            className={actionClass}
            onClick={onCancelDelete}
          >
            Non
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          {request.status === "pending" && (
            <button type="button" disabled={busy} className={actionClass} onClick={onAccept}>
              Valider
            </button>
          )}
          <button
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
