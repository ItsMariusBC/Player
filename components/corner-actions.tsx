// components/corner-actions.tsx
// Bottom-left row of bare actions: admins get « Administration » then « Se déconnecter ».
import { AdminButton } from "@/components/admin-button";
import { LogoutLink } from "@/components/logout-link";

export function CornerActions({ isAdmin, onOpenAdmin }: { isAdmin: boolean; onOpenAdmin: () => void }) {
  return (
    <div className="fixed left-3 bottom-3 z-30 flex items-center gap-5 md:left-4 md:bottom-4">
      {isAdmin && <AdminButton onOpen={onOpenAdmin} />}
      <LogoutLink />
    </div>
  );
}
