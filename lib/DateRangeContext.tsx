"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { inRange, parseRangeState, resolveRange, type RangeState, type ResolvedRange } from "./dateRange";

type Ctx = {
  range: ResolvedRange;
  state: RangeState;
  setState: (s: RangeState) => void;
  /** Is this date / ISO timestamp inside the global range? */
  within: (when: string | null | undefined) => boolean;
};

const C = createContext<Ctx | null>(null);
const KEY = "dashboard.dateRange";
const localToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [state, setStateRaw] = useState<RangeState>({ preset: "all", from: null, to: null });
  const [today, setToday] = useState(localToday());

  // Restore the last choice (localStorage can throw or be empty — both are fine).
  useEffect(() => {
    try { setStateRaw(parseRangeState(window.localStorage.getItem(KEY))); } catch { /* ignore */ }
    const t = setInterval(() => setToday(localToday()), 10 * 60_000); // rolls over at midnight
    return () => clearInterval(t);
  }, []);

  const setState = useCallback((s: RangeState) => {
    setStateRaw(s);
    try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  }, []);

  const range = useMemo(() => resolveRange(state, today), [state, today]);
  const within = useCallback((w: string | null | undefined) => inRange(range, w), [range]);
  const value = useMemo(() => ({ range, state, setState, within }), [range, state, setState, within]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useDateRange(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error("useDateRange must be used inside DateRangeProvider");
  return v;
}
