// lib/requests-format.ts
// Pure helpers of the song request UI (status labels, details line, admin order, error text).
// No React here, so the Bun unit tests import them directly.
import type { SongRequestDto, SongRequestStatus } from "@/lib/requests-api";

const STATUS_LABELS: Record<SongRequestStatus, string> = {
  pending: "En attente",
  accepted: "Acceptée",
  added: "Ajoutée",
  rejected: "Refusée",
};

export function requestStatusLabel(status: SongRequestStatus): string {
  return STATUS_LABELS[status];
}

/** The label, followed by « : motif » for a rejected request that has a reason. */
export function requestStatusDetail(
  request: Pick<SongRequestDto, "status" | "rejectReason">,
): string {
  const label = requestStatusLabel(request.status);
  const reason = request.rejectReason?.trim();
  return request.status === "rejected" && reason ? `${label} : ${reason}` : label;
}

/** "Album · 1905": the parts that exist, in that order. */
export function requestDetails(request: Pick<SongRequestDto, "album" | "year">): string {
  return [request.album, request.year?.toString()]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/** Pending first, then accepted; most recent first inside each group (the server's order). */
export function sortAdminRequests<T extends Pick<SongRequestDto, "id" | "status" | "createdAt">>(
  list: readonly T[],
): T[] {
  const rank = (status: SongRequestStatus) => (status === "pending" ? 0 : 1);
  return list
    .slice()
    .sort(
      (a, b) =>
        rank(a.status) - rank(b.status) ||
        (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );
}

export function pendingCount(list: readonly Pick<SongRequestDto, "status">[]): number {
  return list.filter((request) => request.status === "pending").length;
}

const ERROR_MESSAGES: Record<string, string> = {
  request_limit: "Vous avez déjà 20 demandes en attente",
  request_duplicate: "Vous avez déjà demandé ce titre",
  request_not_found: "Cette demande n'existe plus",
  request_not_pending: "Cette demande a déjà été traitée",
  proposal_expired: "Les propositions ont expiré, relancez la recherche",
};

export function requestErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && Object.hasOwn(ERROR_MESSAGES, code)) return ERROR_MESSAGES[code];
  if (error instanceof Error && error.message) return error.message;
  return "Action impossible";
}
