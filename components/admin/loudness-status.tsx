// components/admin/loudness-status.tsx
// One line under the track table: how many tracks have a measured loudness, and a
// button queueing the measurement of the others.
import { buttonVariants } from "@/components/ui/button";
import { useLoudnessStatus } from "@/lib/hooks/use-loudness-status";
import { cn } from "@/lib/cn";

export function LoudnessStatus({ onError }: { onError: (error: unknown) => void }) {
  const { status, busy, start } = useLoudnessStatus(onError);
  if (!status) return null;
  const disabled = busy || status.running || status.pending === 0 || !status.available;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-purple-200/70">
      <span>
        Volume : {status.measured} titres sur {status.total} analysés
      </span>
      <button
        type="button"
        className={cn(buttonVariants({ variant: "ghost" }), "disabled:opacity-50")}
        disabled={disabled}
        onClick={() => void start()}
      >
        Analyser les titres restants
      </button>
      {status.failed > 0 && <span>{status.failed} titres sans mesure</span>}
      {!status.available && <span>ffmpeg introuvable sur le serveur</span>}
    </div>
  );
}
