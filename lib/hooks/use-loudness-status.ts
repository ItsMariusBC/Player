// lib/hooks/use-loudness-status.ts
// Loudness measurement status for the admin Catalogue view. Loads on mount; while a backfill
// pass is running (`running`), polls every 2 s with chained timeouts (never two requests in
// flight) and stops as soon as the pass ends. Failures go through onError.
import { useCallback, useEffect, useRef, useState } from "react";
import { type LoudnessStatus, backfillLoudness, getLoudnessStatus } from "@/lib/admin-api";

const POLL_MS = 2000;

export interface LoudnessState {
  status: LoudnessStatus | null;
  /** True while the click on the backfill button is being processed. */
  busy: boolean;
  start: () => Promise<void>;
}

export function useLoudnessStatus(onError: (error: unknown) => void): LoudnessState {
  const [status, setStatus] = useState<LoudnessStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    getLoudnessStatus()
      .then((next) => {
        if (aliveRef.current) setStatus(next);
      })
      .catch((error) => {
        if (aliveRef.current) onErrorRef.current(error);
      });
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const running = status?.running === true;
  useEffect(() => {
    if (!running) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(() => {
        getLoudnessStatus()
          .then((next) => {
            if (!active) return;
            setStatus(next);
            if (next.running) schedule();
          })
          .catch((error) => {
            if (active) onErrorRef.current(error);
          });
      }, POLL_MS);
    };
    schedule();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [running]);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      await backfillLoudness();
      const next = await getLoudnessStatus();
      if (aliveRef.current) setStatus(next);
    } catch (error) {
      if (aliveRef.current) onErrorRef.current(error);
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, []);

  return { status, busy, start };
}
