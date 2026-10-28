// lib/hooks/use-media-status.ts
// Media optimisation status for the admin Catalogue view. Loads on mount; while an optimisation
// pass is running (`running`), polls every 2 s; otherwise it refreshes every 10 s while the
// panel is open (an automatic pass may have started after an import). Chained timeouts: never
// two requests in flight, and everything stops on unmount. Failures go through onError.
import { useCallback, useEffect, useRef, useState } from "react";
import { type MediaStatus, startMediaOptimize, getMediaStatus } from "@/lib/admin-api";

const POLL_MS = 2000;
const IDLE_POLL_MS = 10_000;

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

  // Polls from the first status on: fast while running, slow otherwise. A restarted effect on a
  // `running` change cancels the pending timer, so only one request chain lives at a time.
  const running = status === null ? null : status.running;
  useEffect(() => {
    if (running === null) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (wasRunning: boolean) => {
      timer = setTimeout(
        () => {
          getMediaStatus()
            .then((next) => {
              if (!active) return;
              setStatus(next);
              // A change of `running` re-runs this effect; otherwise keep the chain going.
              if (next.running === wasRunning) schedule(wasRunning);
            })
            .catch((error) => {
              if (active) onErrorRef.current(error);
            });
        },
        wasRunning ? POLL_MS : IDLE_POLL_MS,
      );
    };
    schedule(running);
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
