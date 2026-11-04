// Pure date-range logic for the global picker (client-safe, no React).
import { addDays } from "./dates";

export type RangePreset = "7d" | "30d" | "90d" | "ytd" | "365d" | "all" | "custom";
export type RangeState = { preset: RangePreset; from: string | null; to: string | null };

export const PRESETS: { id: RangePreset; label: string }[] = [
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "90d", label: "90d" },
  { id: "ytd", label: "YTD" },
  { id: "365d", label: "1y" },
  { id: "all", label: "All" },
  { id: "custom", label: "Custom" },
];

export type ResolvedRange = {
  preset: RangePreset;
  from: string | null; // inclusive YYYY-MM-DD, null = no lower bound
  to: string | null; // inclusive, null = no upper bound
  label: string;
  isAll: boolean;
  days: number | null; // length of the window, null for open-ended
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function resolveRange(s: RangeState, today: string): ResolvedRange {
  const mk = (from: string | null, to: string | null, label: string): ResolvedRange => ({
    preset: s.preset, from, to, label, isAll: from === null && to === null,
    days: from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 : null,
  });
  switch (s.preset) {
    case "7d": return mk(addDays(today, -6), today, "Last 7 days");
    case "30d": return mk(addDays(today, -29), today, "Last 30 days");
    case "90d": return mk(addDays(today, -89), today, "Last 90 days");
    case "365d": return mk(addDays(today, -364), today, "Last 12 months");
    case "ytd": return mk(`${today.slice(0, 4)}-01-01`, today, "Year to date");
    case "custom": {
      let from = s.from && ISO.test(s.from) ? s.from : null;
      let to = s.to && ISO.test(s.to) ? s.to : null;
      if (from && to && from > to) [from, to] = [to, from];
      return mk(from, to, from || to ? `${from ?? "…"} → ${to ?? "today"}` : "All time");
    }
    default: return mk(null, null, "All time");
  }
}

/** Is a date or ISO timestamp inside the range? Missing dates are excluded when a range is active. */
export function inRange(r: ResolvedRange, when: string | null | undefined): boolean {
  if (r.isAll) return true;
  if (!when) return false;
  const day = when.slice(0, 10);
  return (!r.from || day >= r.from) && (!r.to || day <= r.to);
}

export function parseRangeState(raw: string | null): RangeState {
  try {
    const j = JSON.parse(raw ?? "") as Partial<RangeState>;
    if (j && PRESETS.some((p) => p.id === j.preset)) return { preset: j.preset!, from: j.from ?? null, to: j.to ?? null };
  } catch { /* fall through */ }
  return { preset: "all", from: null, to: null };
}
