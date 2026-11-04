"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  fetchMetricsClient,
  NotAuthenticatedError,
  NotAuthorizedError,
} from "@/lib/fetchMetricsClient";
import { fetchMarketingClient } from "@/lib/fetchMarketingClient";
import { seoFetch } from "@/lib/seoClient";
import type { Metrics } from "@/lib/metrics";
import type { MarketingMetrics } from "@/lib/marketing";

type DashboardContextValue = {
  metrics: Metrics | null;
  marketing: MarketingMetrics | null;
  marketingError: string | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

/**
 * Fetches subscriber + marketing data once and shares it across every
 * page (Overview, Subscribers, Marketing) via context, so switching
 * tabs doesn't re-fetch. The refresh button (in the layout) re-runs
 * both fetches; each page just reads from here.
 */
export function DashboardProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [marketing, setMarketing] = useState<MarketingMetrics | null>(null);
  const [marketingError, setMarketingError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadMarketing = useCallback(async () => {
    try {
      const data = await fetchMarketingClient();
      setMarketing(data);
      setMarketingError(null);
    } catch (err) {
      setMarketingError(
        err instanceof Error ? err.message : "Couldn't load marketing data."
      );
      console.error(err);
    }
  }, []);

  const loadMetrics = useCallback(async (): Promise<boolean> => {
    try {
      const data = await fetchMetricsClient();
      setMetrics(data);
      setError(null);
      return true;
    } catch (err) {
      if (err instanceof NotAuthenticatedError) {
        router.replace("/login");
        return false;
      }
      if (err instanceof NotAuthorizedError) {
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
        router.replace("/login?error=not_authorized");
        return false;
      }
      setError(err instanceof Error ? err.message : "Couldn't load metrics.");
      console.error(err);
      return false;
    }
  }, [router]);

  useEffect(() => {
    let active = true;
    async function init() {
      const ok = await loadMetrics();
      if (ok && active) await loadMarketing();
      if (active) setLoading(false);
      // Take today's snapshot once per day per browser (server also dedupes).
      if (ok) {
        try {
          const key = `snap-${new Date().toISOString().slice(0, 10)}`;
          if (!localStorage.getItem(key)) {
            await seoFetch("/api/snapshot", { method: "POST", body: "{}" });
            localStorage.setItem(key, "1");
          }
        } catch {
          /* snapshots are best-effort */
        }
      }
    }
    init();
    return () => {
      active = false;
    };
    // Only run once on mount — loadMetrics/loadMarketing are stable
    // (useCallback) but intentionally not re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setRefreshing(true);
    const ok = await loadMetrics();
    if (ok) await loadMarketing();
    setRefreshing(false);
  }

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <DashboardContext.Provider
      value={{
        metrics,
        marketing,
        marketingError,
        error,
        loading,
        refreshing,
        refresh,
        signOut,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    throw new Error("useDashboard must be used within DashboardProvider");
  }
  return ctx;
}
