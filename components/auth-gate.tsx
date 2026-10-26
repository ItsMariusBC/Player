// components/auth-gate.tsx
// Renders the player only once the server session is valid and authorised.
import { createContext, useContext, type ReactNode } from "react";
import { AccessDenied } from "@/components/access-denied";
import type { SessionInfo } from "@/lib/api";
import { useSession } from "@/lib/hooks/use-session";

const SessionContext = createContext<SessionInfo | null>(null);

export function useSessionInfo(): SessionInfo {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSessionInfo must be used inside <AuthGate>");
  return session;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const state = useSession();

  if (state.status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500 mx-auto"></div>
          <p className="mt-4 text-purple-200">Chargement du lecteur…</p>
        </div>
      </div>
    );
  }
  if (state.status === "denied") return <AccessDenied />;

  return <SessionContext value={state.session}>{children}</SessionContext>;
}
