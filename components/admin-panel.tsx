// components/admin-panel.tsx
// Empty admin shell, sized and styled like the expanded visualizer. The page
// unmounts the rest of the UI while it is shown. Import, folders and metadata
// land here later.
import { useEffect } from "react";
import { m } from "framer-motion";
import { PanelButton } from "@/components/visualizer-panel";
import { buttonVariants } from "@/components/ui/button";
import { performLogout } from "@/lib/api";
import { cn } from "@/lib/cn";

export function AdminPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <m.div
      role="dialog"
      aria-modal="true"
      aria-label="Administration"
      className="fixed inset-4 flex flex-col overflow-hidden rounded-2xl border border-purple-100/10 bg-purple-950/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] md:inset-8 md:p-6"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.9 }}
    >
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-sm uppercase tracking-widest text-purple-200/70">Administration</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cn(buttonVariants({ variant: "ghost" }))}
            onClick={() => void performLogout()}
          >
            Se déconnecter
          </button>
          <PanelButton label="Fermer l'administration" onClick={onClose}>
            <CloseIcon />
          </PanelButton>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center text-center text-sm text-purple-200/60">
        Import, dossiers et métadonnées arrivent ici.
      </div>
    </m.div>
  );
}

function CloseIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
