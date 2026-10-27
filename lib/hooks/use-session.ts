// lib/hooks/use-session.ts
// Resolves the server session and re-checks it periodically to detect expiry.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  fetchDevBypassStatus,
  fetchSession,
  redirectToLogin,
  type SessionInfo,
} from "@/lib/api";

export type SessionState =
  | { status: "loading" }
  | { status: "ready"; session: SessionInfo }
  | { status: "denied"; reason: "no_group"; displayName: string | null }
  | { status: "bypass" }
  | { status: "error"; message: string };

export type SessionCheck = { kind: "ok"; session: SessionInfo } | { kind: "error"; error: unknown };

export type NextState =
  | { action: "set"; state: SessionState }
  | { action: "redirect" }
  | { action: "keep" };

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const GENERIC_ERROR = "Erreur inconnue";

function deniedDisplayName(error: ApiError): string | null {
  const user = (error.details as { user?: { displayName?: unknown } } | undefined)?.user;
  return typeof user?.displayName === "string" ? user.displayName : null;
}

// Pure decision logic. A failed background poll (initial = false) never replaces what is on
// screen with the error panel; auth outcomes (401, 403 no_group) always apply.
export function decideSessionState(
  check: SessionCheck,
  bypassAvailable: boolean,
  initial: boolean,
): NextState {
  if (check.kind === "ok") {
    return { action: "set", state: { status: "ready", session: check.session } };
  }
  const { error } = check;
  if (error instanceof ApiError && error.status === 401) {
    return bypassAvailable
      ? { action: "set", state: { status: "bypass" } }
      : { action: "redirect" };
  }
  if (error instanceof ApiError && error.status === 403 && error.code === "no_group") {
    return {
      action: "set",
      state: { status: "denied", reason: "no_group", displayName: deniedDisplayName(error) },
    };
  }
  if (!initial) return { action: "keep" };
  return {
    action: "set",
    state: { status: "error", message: error instanceof ApiError ? error.message : GENERIC_ERROR },
  };
}

export function useSession(): SessionState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const cancelled = useRef(false);

  const refresh = useCallback(async (initial = true) => {
    let check: SessionCheck;
    try {
      check = { kind: "ok", session: await fetchSession() };
    } catch (error) {
      check = { kind: "error", error };
    }
    if (cancelled.current) return;
    if (check.kind === "error" && !(check.error instanceof ApiError && check.error.status < 500 && [401, 403].includes(check.error.status))) {
      console.error("Session check failed", check.error);
    }
    const bypassAvailable =
      check.kind === "error" && check.error instanceof ApiError && check.error.status === 401
        ? await fetchDevBypassStatus()
        : false;
    if (cancelled.current) return;
    const next = decideSessionState(check, bypassAvailable, initial);
    if (next.action === "redirect") {
      // Navigation unloads the page (and the audio) so no cleanup is needed.
      redirectToLogin();
      setState({ status: "loading" });
    } else if (next.action === "set") {
      setState(next.state);
    }
  }, []);

  useEffect(() => {
    cancelled.current = false;
    void refresh(true);
    const timer = setInterval(() => void refresh(false), POLL_INTERVAL_MS);
    return () => {
      cancelled.current = true;
      clearInterval(timer);
    };
  }, [refresh]);

  const manualRefresh = useCallback(() => refresh(true), [refresh]);
  return { ...state, refresh: manualRefresh };
}
