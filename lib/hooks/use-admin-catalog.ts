// lib/hooks/use-admin-catalog.ts
// Data source of the admin panel: the same GET /api/catalog as the player (it lists every
// folder, empty ones included, and every ready track). refreshAdmin() reloads it after a
// mutation and rejects on failure, so the panel can show the error.
import { useCallback, useEffect, useRef, useState } from "react";
import { type Catalog, fetchCatalog } from "@/lib/catalog";

export interface AdminCatalogState {
  status: "loading" | "ready" | "error";
  /** Last catalogue received; kept when a later refresh fails. */
  catalog?: Catalog;
  /** Resolves with the catalogue just fetched. */
  refreshAdmin(): Promise<Catalog>;
}

export function useAdminCatalog(onError: (error: unknown) => void): AdminCatalogState {
  const [state, setState] = useState<Omit<AdminCatalogState, "refreshAdmin">>({
    status: "loading",
  });
  const mounted = useRef(true);
  // Only the latest request may update the state.
  const latest = useRef(0);

  const refreshAdmin = useCallback(async () => {
    const request = ++latest.current;
    try {
      const catalog = await fetchCatalog();
      if (mounted.current && request === latest.current) setState({ status: "ready", catalog });
      return catalog;
    } catch (error) {
      if (mounted.current && request === latest.current) {
        setState((prev) => ({ status: "error", catalog: prev.catalog }));
      }
      throw error;
    }
  }, []);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    mounted.current = true;
    refreshAdmin().catch((error: unknown) => {
      if (mounted.current) onErrorRef.current(error);
    });
    return () => {
      mounted.current = false;
    };
  }, [refreshAdmin]);

  return { ...state, refreshAdmin };
}
