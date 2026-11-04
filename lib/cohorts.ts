// Pure, client-safe cohort retention from login days.
import { addDays, weekStart } from "./dates";

export type CohortUser = { id: string; joinedAt: string; isPaid?: boolean };
export type CohortRow = {
  week: string; // Monday of signup week
  size: number;
  // For each checkpoint: how many were active in that week-after-signup,
  // or null if the cohort isn't old enough yet to judge fairly.
  retained: Record<number, { n: number; pct: number } | null>;
};

export const CHECKPOINTS = [1, 2, 4, 8];

/**
 * "Active in week N" = at least one login in days [7N, 7N+7) after signup.
 * A user only counts toward a checkpoint once that whole window has passed,
 * so recent cohorts show "—" instead of looking falsely bad.
 */
export function cohortRetention(users: CohortUser[], loginDays: Record<string, string[]>, today = new Date().toISOString().slice(0, 10)): CohortRow[] {
  const byWeek = new Map<string, CohortUser[]>();
  for (const u of users) {
    const w = weekStart(u.joinedAt.slice(0, 10));
    (byWeek.get(w) ?? byWeek.set(w, []).get(w)!).push(u);
  }
  const rows: CohortRow[] = [];
  for (const [week, list] of [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const retained: CohortRow["retained"] = {};
    for (const n of CHECKPOINTS) {
      const eligible = list.filter((u) => addDays(u.joinedAt.slice(0, 10), 7 * n + 7) <= today);
      if (eligible.length === 0) { retained[n] = null; continue; }
      const hit = eligible.filter((u) => {
        const start = addDays(u.joinedAt.slice(0, 10), 7 * n);
        const end = addDays(u.joinedAt.slice(0, 10), 7 * n + 7);
        return (loginDays[u.id] ?? []).some((d) => d >= start && d < end);
      }).length;
      retained[n] = { n: hit, pct: hit / eligible.length };
    }
    rows.push({ week, size: list.length, retained });
  }
  return rows;
}
