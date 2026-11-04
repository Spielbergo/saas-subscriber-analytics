"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Metrics } from "@/lib/metrics";

export class NotAuthenticatedError extends Error {}
export class NotAuthorizedError extends Error {}

export async function fetchMetricsClient(): Promise<Metrics> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new NotAuthenticatedError();
  }

  const res = await fetch("/api/metrics", {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (res.status === 401) {
    throw new NotAuthorizedError();
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.detail ?? body?.error ?? "";
    } catch {
      // response wasn't JSON — ignore
    }
    throw new Error(detail ? `Failed to load metrics: ${detail}` : "Failed to load metrics");
  }

  return res.json();
}
