import { describe, expect, test } from "bun:test";
import { ApiError } from "../../lib/api";
import {
  pendingCount,
  requestDetails,
  requestErrorMessage,
  requestStatusDetail,
  requestStatusLabel,
  sortAdminRequests,
} from "../../lib/requests-format";

const req = (
  id: string,
  status: "pending" | "accepted" | "added" | "rejected",
  createdAt: string,
) => ({
  id,
  status,
  createdAt,
});

describe("requestStatusLabel", () => {
  test("labels the four statuses", () => {
    expect(requestStatusLabel("pending")).toBe("En attente");
    expect(requestStatusLabel("accepted")).toBe("Acceptée");
    expect(requestStatusLabel("added")).toBe("Ajoutée");
    expect(requestStatusLabel("rejected")).toBe("Refusée");
  });
});

describe("requestStatusDetail", () => {
  test("appends the reason of a rejected request", () => {
    expect(requestStatusDetail({ status: "rejected", rejectReason: "Doublon" })).toBe(
      "Refusée : Doublon",
    );
  });
  test("plain label without a reason or for other statuses", () => {
    expect(requestStatusDetail({ status: "rejected", rejectReason: null })).toBe("Refusée");
    expect(requestStatusDetail({ status: "rejected", rejectReason: "  " })).toBe("Refusée");
    expect(requestStatusDetail({ status: "added", rejectReason: null })).toBe("Ajoutée");
  });
});

describe("requestDetails", () => {
  test("joins album and year", () => {
    expect(requestDetails({ album: "Album", year: 1905 })).toBe("Album · 1905");
  });
  test("skips missing parts", () => {
    expect(requestDetails({ album: null, year: 1905 })).toBe("1905");
    expect(requestDetails({ album: "Album", year: null })).toBe("Album");
    expect(requestDetails({ album: null, year: null })).toBe("");
  });
});

describe("sortAdminRequests", () => {
  test("pending first, newest first in each group, without mutating", () => {
    const input = [
      req("a", "accepted", "2026-01-03"),
      req("b", "pending", "2026-01-01"),
      req("c", "pending", "2026-01-02"),
      req("d", "accepted", "2026-01-04"),
    ];
    const copy = [...input];
    expect(sortAdminRequests(input).map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
    expect(input).toEqual(copy);
  });
  test("ties by id descending", () => {
    const list = [req("a", "pending", "t"), req("b", "pending", "t")];
    expect(sortAdminRequests(list).map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("pendingCount", () => {
  test("counts pending only", () => {
    expect(pendingCount([])).toBe(0);
    expect(pendingCount([req("a", "pending", "t"), req("b", "accepted", "t")])).toBe(1);
  });
});

describe("requestErrorMessage", () => {
  test("maps known codes", () => {
    expect(requestErrorMessage(new ApiError(409, "request_limit", "x"))).toBe(
      "Vous avez déjà 20 demandes en attente",
    );
    expect(requestErrorMessage(new ApiError(409, "request_duplicate", "x"))).toBe(
      "Vous avez déjà demandé ce titre",
    );
    expect(requestErrorMessage(new ApiError(404, "proposal_expired", "x"))).toBe(
      "Les propositions ont expiré, relancez la recherche",
    );
    expect(requestErrorMessage(new ApiError(404, "request_not_found", "x"))).toBe(
      "Cette demande n'existe plus",
    );
    expect(requestErrorMessage(new ApiError(409, "request_not_pending", "x"))).toBe(
      "Cette demande a déjà été traitée",
    );
  });
  test("falls back to the message, then to a generic one", () => {
    expect(requestErrorMessage(new ApiError(500, "internal", "Boom"))).toBe("Boom");
    expect(requestErrorMessage(new Error("Oups"))).toBe("Oups");
    expect(requestErrorMessage("nope")).toBe("Action impossible");
    expect(requestErrorMessage(null)).toBe("Action impossible");
    expect(requestErrorMessage(new Error(""))).toBe("Action impossible");
  });
});
