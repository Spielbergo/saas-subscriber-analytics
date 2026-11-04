"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MarketingMetrics } from "@/lib/marketing";

export async function fetchMarketingClient(): Promise<MarketingMetrics | null> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Not logged in / not authorized — the main metrics fetch already
  // handles redirecting for these cases, so just no-op here rather
  // than duplicating that logic.
  if (!session) return null;

  const res = await fetch("/api/marketing", {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (res.status === 401) return null;

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.detail ?? body?.error ?? "";
    } catch {
      // response wasn't JSON — ignore
    }
    throw new Error(
      detail ? `Failed to load marketing data: ${detail}` : "Failed to load marketing data"
    );
  }

  return res.json();
}
