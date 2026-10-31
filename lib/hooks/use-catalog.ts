// lib/hooks/use-catalog.ts
// Loads the catalogue on mount, re-checks it every minute and exposes refresh()
// (the admin panel calls it after each mutation). 401 is handled by the session gate.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { type Catalog, fetchCatalog } from "@/lib/catalog";

export interface CatalogState {
  status: "loading" | "ready" | "error";
  /** Last catalogue received; kept when a later refresh fails. */
  catalog?: Catalog;
  error?: string;
  refresh(): Promise<void>;
}

const POLL_INTERVAL_MS = 60 * 1000;
const GENERIC_ERROR = "Impossible de charger le catalogue";

export function useCatalog(): CatalogState {
  const [state, setState] = useState<Omit<CatalogState, "refresh">>({ status: "loading" });
  const mounted = useRef(true);
  // Only the latest request may update the state (a slow poll never overwrites a refresh).
  const latest = useRef(0);
  const lastJson = useRef<string>(undefined);

  const refresh = useCallback(async () => {
    const request = ++latest.current;
    try {
      const catalog = await fetchCatalog();
      if (!mounted.current || request !== latest.current) return;
      // An unchanged catalogue keeps its identity so the player does nothing.
      const json = JSON.stringify(catalog);
      const changed = json !== lastJson.current;
      lastJson.current = json;
      setState((prev) => ({
        status: "ready",
        catalog: changed || !prev.catalog ? catalog : prev.catalog,
      }));
    } catch (error) {
      if (!mounted.current || request !== latest.current) return;
      console.error("Catalogue load failed", error);
      setState((prev) => ({
        status: "error",
        catalog: prev.catalog,
        error: error instanceof ApiError ? error.message : GENERIC_ERROR,
      }));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  return { ...state, refresh };
}
