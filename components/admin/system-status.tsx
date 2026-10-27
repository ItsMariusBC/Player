// components/admin/system-status.tsx
// Two lines under the loudness line: the server health and the last maintenance pass, with a
// button running a pass now.
import { buttonVariants } from "@/components/ui/button";
import { healthLabel, maintenanceLabel } from "@/lib/admin-format";
import { useSystemStatus } from "@/lib/hooks/use-system-status";
import { cn } from "@/lib/cn";

export function SystemStatus({ onError }: { onError: (error: unknown) => void }) {
  const { health, maintenance, busy, run } = useSystemStatus(onError);
  if (!health || !maintenance) return null;
  return (
    <div className="flex flex-col gap-1 text-sm text-purple-200/70">
      <span className={cn(health.status === "degraded" && "text-red-200")}>
        {healthLabel(health)}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <span>{maintenanceLabel(maintenance)}</span>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "ghost" }), "disabled:opacity-50")}
          disabled={busy || maintenance.running}
          onClick={() => void run()}
        >
          Lancer l'entretien
        </button>
      </div>
    </div>
  );
}
