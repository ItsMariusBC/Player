// components/access-denied.tsx
// Shown when the account is authenticated but belongs to no authorised group.
import { buttonVariants } from "@/components/ui/button";
import { logout } from "@/lib/api";
import { cn } from "@/lib/cn";

export function AccessDenied() {
  const onLogout = async () => {
    try {
      const { redirect } = await logout();
      window.location.assign(redirect);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  return (
    <main className="flex min-h-svh items-center justify-center px-6 text-purple-100">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Accès refusé</h1>
        <p className="mt-3 text-purple-200">Ton compte n'appartient à aucun groupe autorisé.</p>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "ghost" }), "mt-6")}
          onClick={onLogout}
        >
          Se déconnecter
        </button>
      </div>
    </main>
  );
}
