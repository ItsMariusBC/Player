// lib/hooks/use-system-status.ts
// Health report and maintenance status for the admin Catalogue view. Loads both on mount and
// again after a maintenance run. Failures go through onError.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type HealthReport,
  type MaintenanceStatus,
  getHealth,
  getMaintenance,
  runMaintenance,
} from "@/lib/admin-api";

export interface SystemState {
  health: HealthReport | null;
  maintenance: MaintenanceStatus | null;
  /** True while a maintenance run requested from this view is in flight. */
  busy: boolean;
  run: () => Promise<void>;
}

export function useSystemStatus(onError: (error: unknown) => void): SystemState {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    const [nextHealth, nextMaintenance] = await Promise.all([getHealth(), getMaintenance()]);
    if (!aliveRef.current) return;
    setHealth(nextHealth);
    setMaintenance(nextMaintenance);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load().catch((error) => {
      if (aliveRef.current) onErrorRef.current(error);
    });
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      await runMaintenance();
      await load();
    } catch (error) {
      if (aliveRef.current) onErrorRef.current(error);
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [load]);

  return { health, maintenance, busy, run };
}
