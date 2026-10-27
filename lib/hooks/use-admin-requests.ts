// lib/hooks/use-admin-requests.ts
// Data source of the admin « Demandes » view and of the pending count in the header tab.
// Loads on mount; refresh() reloads after an action and reports failures through onError.
import { useCallback, useEffect, useRef, useState } from "react";
import { type AdminSongRequestDto, listAdminRequests } from "@/lib/requests-api";
import { pendingCount, sortAdminRequests } from "@/lib/requests-format";

export interface AdminRequestsState {
  requests: AdminSongRequestDto[];
  pending: number;
  refresh: () => Promise<void>;
}

export function useAdminRequests(onError: (error: unknown) => void): AdminRequestsState {
  const [requests, setRequests] = useState<AdminSongRequestDto[]>([]);
  const mounted = useRef(true);
  // Only the latest request may update the state.
  const latest = useRef(0);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const list = await listAdminRequests();
      if (mounted.current && ticket === latest.current) setRequests(sortAdminRequests(list));
    } catch (error) {
      if (mounted.current) onErrorRef.current(error);
    }
  }, []);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    listAdminRequests()
      .then((list) => {
        if (active && latest.current === 0) setRequests(sortAdminRequests(list));
      })
      .catch((error: unknown) => {
        if (active) onErrorRef.current(error);
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);

  return { requests, pending: pendingCount(requests), refresh };
}
