import { describe, expect, test } from "bun:test";
import { ApiError, type SessionInfo } from "../../lib/api";
import { decideSessionState } from "../../lib/hooks/use-session";

const session: SessionInfo = {
  user: { id: "u1", displayName: "Alice" },
  role: "user",
  expiresAt: "2026-10-27T00:00:00Z",
};

const error = (e: unknown) => ({ kind: "error" as const, error: e });

describe("decideSessionState", () => {
  test("ok becomes ready", () => {
    expect(decideSessionState({ kind: "ok", session }, false, true)).toEqual({
      action: "set",
      state: { status: "ready", session },
    });
  });

  test("401 without bypass redirects to login", () => {
    const err = new ApiError(401, "session_required", "x");
    expect(decideSessionState(error(err), false, true)).toEqual({ action: "redirect" });
  });

  test("401 with bypass shows the bypass panel", () => {
    const err = new ApiError(401, "session_required", "x");
    expect(decideSessionState(error(err), true, true)).toEqual({
      action: "set",
      state: { status: "bypass" },
    });
  });

  test("403 no_group is denied and carries the display name", () => {
    const err = new ApiError(403, "no_group", "x", {
      error: { code: "no_group" },
      user: { displayName: "Nobody Test" },
    });
    expect(decideSessionState(error(err), false, true)).toEqual({
      action: "set",
      state: { status: "denied", reason: "no_group", displayName: "Nobody Test" },
    });
  });

  test("403 no_group without details falls back to a null name", () => {
    const err = new ApiError(403, "no_group", "x");
    expect(decideSessionState(error(err), false, true)).toEqual({
      action: "set",
      state: { status: "denied", reason: "no_group", displayName: null },
    });
  });

  test("other ApiError becomes an error with its message", () => {
    const err = new ApiError(500, "internal_error", "Boom");
    expect(decideSessionState(error(err), false, true)).toEqual({
      action: "set",
      state: { status: "error", message: "Boom" },
    });
  });

  test("non-ApiError becomes a generic error", () => {
    expect(decideSessionState(error(new TypeError("net")), false, true)).toEqual({
      action: "set",
      state: { status: "error", message: "Erreur inconnue" },
    });
  });

  test("a failed background poll keeps the current state", () => {
    expect(decideSessionState(error(new TypeError("net")), false, false)).toEqual({
      action: "keep",
    });
    expect(
      decideSessionState(error(new ApiError(500, "internal_error", "Boom")), false, false),
    ).toEqual({ action: "keep" });
  });

  test("a poll that finds the session gone still redirects", () => {
    const err = new ApiError(401, "session_expired", "x");
    expect(decideSessionState(error(err), false, false)).toEqual({ action: "redirect" });
  });
});
