// lib/hooks/use-loudness-status.ts
// Loudness measurement status for the admin Catalogue view. Loads on mount; after
// start(), polls every 2 s while tracks remain pending. Failures go through onError.
import { useCallback, useEffect, useRef, useState } from "react";
import { type LoudnessStatus, backfillLoudness, getLoudnessStatus } from "@/lib/admin-api";

const POLL_MS = 2000;

export interface LoudnessState {
  status: LoudnessStatus | null;
  start: () => Promise<void>;
}

export function useLoudnessStatus(onError: (error: unknown) => void): LoudnessState {
  const [status, setStatus] = useState<LoudnessStatus | null>(null);
  const [polling, setPolling] = useState(false);
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

  useEffect(() => {
    if (!polling) return;
    let active = true;
    const timer = setInterval(() => {
      getLoudnessStatus()
        .then((next) => {
          if (!active) return;
          setStatus(next);
          if (next.pending === 0) setPolling(false);
        })
        .catch((error) => {
          if (!active) return;
          setPolling(false);
          onErrorRef.current(error);
        });
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [polling]);

  const start = useCallback(async () => {
    try {
      await backfillLoudness();
      const next = await getLoudnessStatus();
      if (!aliveRef.current) return;
      setStatus(next);
      setPolling(next.pending > 0);
    } catch (error) {
      if (aliveRef.current) onErrorRef.current(error);
    }
  }, []);

  return { status, start };
}
