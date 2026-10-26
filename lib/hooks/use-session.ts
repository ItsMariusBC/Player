// lib/hooks/use-session.ts
// Resolves the server session and re-checks it periodically to detect expiry.
import { useEffect, useState } from "react";
import { ApiError, fetchSession, redirectToLogin, type SessionInfo } from "@/lib/api";

export type SessionState =
  | { status: "loading" }
  | { status: "ready"; session: SessionInfo }
  | { status: "denied"; reason: "no_group" };

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const session = await fetchSession();
        if (!cancelled) setState({ status: "ready", session });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          // Navigation unloads the page (and the audio) so no cleanup is needed.
          redirectToLogin();
          setState({ status: "loading" });
        } else if (error instanceof ApiError && error.status === 403 && error.code === "no_group") {
          setState({ status: "denied", reason: "no_group" });
        } else {
          console.error("Session check failed", error);
        }
      }
    };

    void check();
    const timer = setInterval(() => void check(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return state;
}
