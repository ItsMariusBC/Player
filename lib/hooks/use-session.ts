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
  | { status: "denied"; reason: "no_group" }
  | { status: "bypass" }
  | { status: "error"; message: string };

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const GENERIC_ERROR = "Erreur inconnue";

export function useSession(): SessionState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const cancelled = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const session = await fetchSession();
      if (!cancelled.current) setState({ status: "ready", session });
    } catch (error) {
      if (cancelled.current) return;
      if (error instanceof ApiError && error.status === 401) {
        if (await fetchDevBypassStatus()) {
          if (!cancelled.current) setState({ status: "bypass" });
          return;
        }
        // Navigation unloads the page (and the audio) so no cleanup is needed.
        redirectToLogin();
        setState({ status: "loading" });
      } else if (error instanceof ApiError && error.status === 403 && error.code === "no_group") {
        setState({ status: "denied", reason: "no_group" });
      } else {
        console.error("Session check failed", error);
        setState({
          status: "error",
          message: error instanceof ApiError ? error.message : GENERIC_ERROR,
        });
      }
    }
  }, []);

  useEffect(() => {
    cancelled.current = false;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelled.current = true;
      clearInterval(timer);
    };
  }, [refresh]);

  return { ...state, refresh };
}
