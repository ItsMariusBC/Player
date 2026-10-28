// lib/hooks/use-media-status.ts
// Media optimisation status for the admin Catalogue view. Loads on mount; while an optimisation
// pass is running (`running`), polls every 2 s with chained timeouts (never two requests in
// flight) and stops as soon as the pass ends. Failures go through onError.
import { useCallback, useEffect, useRef, useState } from "react";
import { type MediaStatus, startMediaOptimize, getMediaStatus } from "@/lib/admin-api";

const POLL_MS = 2000;

export interface MediaState {
  status: MediaStatus | null;
  /** True while the click on the optimisation button is being processed. */
  busy: boolean;
  start: () => Promise<void>;
}

export function useMediaStatus(onError: (error: unknown) => void): MediaState {
  const [status, setStatus] = useState<MediaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    getMediaStatus()
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
        getMediaStatus()
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
      await startMediaOptimize();
      const next = await getMediaStatus();
      if (aliveRef.current) setStatus(next);
    } catch (error) {
      if (aliveRef.current) onErrorRef.current(error);
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, []);

  return { status, busy, start };
}
