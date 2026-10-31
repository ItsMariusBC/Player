// components/corner-actions.tsx
// Bottom-left bare action: « Administration » for admins (the panel holds « Se déconnecter »),
// « Se déconnecter » for everyone else.
import { AdminButton } from "@/components/admin-button";
import { LogoutLink } from "@/components/logout-link";

export function CornerActions({ isAdmin, onOpenAdmin }: { isAdmin: boolean; onOpenAdmin: () => void }) {
  return (
    <div className="fixed left-3 bottom-3 z-30 flex items-center gap-5 md:left-4 md:bottom-4">
      {isAdmin ? <AdminButton onOpen={onOpenAdmin} /> : <LogoutLink />}
    </div>
  );
}
