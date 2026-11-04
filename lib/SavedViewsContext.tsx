"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { seoFetch } from "./seoClient";
import type { SavedView, ViewsMap } from "./savedViews";

type Ctx = { views: ViewsMap; loaded: boolean; saveFor: (table: string, list: SavedView[]) => Promise<void> };
const C = createContext<Ctx | null>(null);

export function SavedViewsProvider({ children }: { children: ReactNode }) {
  const [views, setViews] = useState<ViewsMap>({});
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(views);
  ref.current = views;

  useEffect(() => {
    seoFetch<{ views: ViewsMap }>("/api/views").then((r) => setViews(r.views ?? {})).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  const saveFor = useCallback(async (table: string, list: SavedView[]) => {
    setViews({ ...ref.current, [table]: list }); // optimistic
    await seoFetch("/api/views", { method: "PUT", body: JSON.stringify({ table, views: list }) }).catch(() => {});
  }, []);

  const value = useMemo(() => ({ views, loaded, saveFor }), [views, loaded, saveFor]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

/** Null when there's no provider (e.g. the login page) — DataTable then hides the Views menu. */
export function useSavedViews(): Ctx | null {
  return useContext(C);
}
