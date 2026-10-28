// components/admin/media-status.tsx
// One line under the loudness line: how many ready tracks have a light variant, and a
// button preparing the others (light variants and WAV to FLAC conversions).
import { buttonVariants } from "@/components/ui/button";
import { useMediaStatus } from "@/lib/hooks/use-media-status";
import { cn } from "@/lib/cn";

export function MediaStatus({ onError }: { onError: (error: unknown) => void }) {
  const { status, busy, start } = useMediaStatus(onError);
  if (!status) return null;
  // Failures are retried by the button too (it clears them first).
  const nothingToDo = status.pending === 0 && status.wav === 0 && status.failed === 0;
  const disabled = busy || status.running || nothingToDo || !status.available;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-purple-200/70">
      <span>
        Lecture allégée : {status.light} titres sur {status.total} prêts
      </span>
      <button
        type="button"
        className={cn(buttonVariants({ variant: "ghost" }), "disabled:opacity-50")}
        disabled={disabled}
        onClick={() => void start()}
      >
        Préparer les titres restants
      </button>
      {status.wav > 0 && <span>{status.wav} titres WAV à convertir</span>}
      {status.failed > 0 && <span>{status.failed} titres sans variante</span>}
      {!status.available && <span>ffmpeg introuvable sur le serveur</span>}
    </div>
  );
}
