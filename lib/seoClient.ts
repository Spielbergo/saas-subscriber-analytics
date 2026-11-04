"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { SeoBundle } from "@/lib/seo/types";

/** Authenticated fetch against /api/seo/*. Throws with the server's detail. */
export async function seoFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.detail ?? body?.error ?? "";
    } catch {
      /* not JSON */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json();
}

export const fetchSeoBundle = (refresh = false) =>
  seoFetch<SeoBundle>(`/api/seo${refresh ? "?refresh=1" : ""}`);
