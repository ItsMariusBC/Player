// components/dev-login.tsx
// Temporary dev-only panel to enter as admin or user without the OIDC provider.
// Only reachable when the server mounts /api/dev (DEV_BYPASS_LOGIN=true, never in production).
import { buttonVariants } from "@/components/ui/button";
import { devLoginAs, redirectToLogin } from "@/lib/api";
import { cn } from "@/lib/cn";

export function DevLogin({ onDone }: { onDone: () => Promise<void> }) {
  const enter = async (role: "admin" | "user") => {
    try {
      await devLoginAs(role);
      await onDone();
    } catch (error) {
      console.error("Dev login failed", error);
    }
  };

  return (
    <main className="flex min-h-svh items-center justify-center px-6 text-purple-100">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Connexion de test</h1>
        <p className="mt-3 text-purple-200">Mode développement, jamais actif en production.</p>
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            className={cn(buttonVariants({ variant: "ghost" }))}
            onClick={() => void enter("admin")}
          >
            Entrer en admin
          </button>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "ghost" }))}
            onClick={() => void enter("user")}
          >
            Entrer en user
          </button>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "ghost" }))}
            onClick={redirectToLogin}
          >
            Connexion OIDC réelle
          </button>
        </div>
      </div>
    </main>
  );
}
