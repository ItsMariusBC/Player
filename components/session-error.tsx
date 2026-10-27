// components/session-error.tsx
// Shown when the session check fails for a reason other than auth (API down, bad proxy).
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function SessionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="flex min-h-svh items-center justify-center px-6 text-purple-100">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Serveur injoignable</h1>
        <p className="mt-3 text-purple-200">Le lecteur n'a pas pu vérifier ta session.</p>
        <p className="mt-2 text-sm text-purple-300/70">{message}</p>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "ghost" }), "mt-6")}
          onClick={onRetry}
        >
          Réessayer
        </button>
      </div>
    </main>
  );
}
