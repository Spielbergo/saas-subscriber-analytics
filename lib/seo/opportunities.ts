import type {
  Cannibalization,
  Opportunities,
  PageChange,
  QueryChange,
  QueryOpportunity,
  QueryStat,
  RankTrend,
} from "./types";

export type ScRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type OpportunityInput = {
  cur: ScRow[]; // dimensions: [query] — current window
  prev: ScRow[]; // dimensions: [query] — previous window
  queryPages: ScRow[]; // dimensions: [query, page] — current window
  pagesCur: ScRow[]; // dimensions: [page]
  pagesPrev: ScRow[];
  daily: ScRow[]; // dimensions: [date, query] — ~90 days
  brandTerms: string[];
  window: { startDate: string; endDate: string };
  previousWindow: { startDate: string; endDate: string };
};

// Rough organic CTR by average position (industry-style benchmarks).
const CTR_BY_POSITION = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
export const expectedCtr = (position: number) =>
  position < 1 ? CTR_BY_POSITION[0] : CTR_BY_POSITION[Math.round(position) - 1] ?? 0.01;

const stat = (r: ScRow): QueryStat => ({
  query: r.keys[0],
  clicks: r.clicks,
  impressions: r.impressions,
  ctr: r.ctr,
  position: r.position,
});

function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function computeOpportunities(input: OpportunityInput): Opportunities {
  const { cur, prev, queryPages, pagesCur, pagesPrev, daily, brandTerms } = input;

  // best page per query (most impressions)
  const bestPage = new Map<string, { page: string; impressions: number }>();
  const pagesByQuery = new Map<string, ScRow[]>();
  for (const r of queryPages) {
    const [q] = r.keys;
    const cur = bestPage.get(q);
    if (!cur || r.impressions > cur.impressions) bestPage.set(q, { page: r.keys[1], impressions: r.impressions });
    const list = pagesByQuery.get(q) ?? [];
    list.push(r);
    pagesByQuery.set(q, list);
  }

  const strikingDistance: QueryOpportunity[] = cur
    .filter((r) => r.position >= 8 && r.position <= 20 && r.impressions >= 10)
    .map((r) => ({
      ...stat(r),
      page: bestPage.get(r.keys[0])?.page ?? null,
      // What reaching ~position 3 could add.
      estimatedExtraClicks: Math.max(0, Math.round(r.impressions * expectedCtr(3) - r.clicks)),
    }))
    .sort((a, b) => b.estimatedExtraClicks - a.estimatedExtraClicks)
    .slice(0, 40);

  const lowCtr: QueryOpportunity[] = cur
    .filter((r) => r.position <= 10 && r.impressions >= 20 && r.ctr < 0.6 * expectedCtr(r.position))
    .map((r) => ({
      ...stat(r),
      page: bestPage.get(r.keys[0])?.page ?? null,
      estimatedExtraClicks: Math.max(0, Math.round(r.impressions * expectedCtr(r.position) - r.clicks)),
    }))
    .sort((a, b) => b.estimatedExtraClicks - a.estimatedExtraClicks)
    .slice(0, 40);

  // ---- query movement ----
  const prevMap = new Map(prev.map((r) => [r.keys[0], r]));
  const curMap = new Map(cur.map((r) => [r.keys[0], r]));
  const changes: QueryChange[] = [];
  for (const r of cur) {
    const p = prevMap.get(r.keys[0]);
    if (!p) continue;
    changes.push({
      ...stat(r),
      prevClicks: p.clicks,
      prevImpressions: p.impressions,
      prevPosition: p.position,
      deltaClicks: r.clicks - p.clicks,
      deltaPosition: Math.round((r.position - p.position) * 10) / 10,
    });
  }
  const rising = changes.filter((c) => c.deltaClicks > 0).sort((a, b) => b.deltaClicks - a.deltaClicks).slice(0, 25);
  const falling = changes.filter((c) => c.deltaClicks < 0).sort((a, b) => a.deltaClicks - b.deltaClicks).slice(0, 25);
  const newQueries = cur
    .filter((r) => !prevMap.has(r.keys[0]) && r.impressions >= 5)
    .map(stat)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 25);
  const lostQueries = prev
    .filter((r) => !curMap.has(r.keys[0]) && r.impressions >= 5)
    .map(stat)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 25);

  // ---- cannibalization ----
  const cannibalization: Cannibalization[] = [];
  for (const [query, rows] of pagesByQuery) {
    const real = rows.filter((r) => r.impressions >= 5);
    const total = real.reduce((n, r) => n + r.impressions, 0);
    if (real.length >= 2 && total >= 20) {
      cannibalization.push({
        query,
        totalImpressions: total,
        pages: real
          .sort((a, b) => b.impressions - a.impressions)
          .map((r) => ({ page: r.keys[1], clicks: r.clicks, impressions: r.impressions, position: r.position })),
      });
    }
  }
  cannibalization.sort((a, b) => b.totalImpressions - a.totalImpressions);

  // ---- page movement ----
  const prevPages = new Map(pagesPrev.map((r) => [r.keys[0], r]));
  const pageChanges: PageChange[] = [];
  for (const r of pagesCur) {
    const p = prevPages.get(r.keys[0]);
    if (!p) continue;
    pageChanges.push({
      page: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      prevClicks: p.clicks,
      prevImpressions: p.impressions,
      deltaClicks: r.clicks - p.clicks,
      deltaPct: p.clicks > 0 ? (r.clicks - p.clicks) / p.clicks : 0,
    });
  }
  // Pages that earned clicks before but vanished from current results.
  const curPageSet = new Set(pagesCur.map((r) => r.keys[0]));
  for (const p of pagesPrev) {
    if (!curPageSet.has(p.keys[0])) {
      pageChanges.push({
        page: p.keys[0], clicks: 0, impressions: 0, prevClicks: p.clicks, prevImpressions: p.impressions,
        deltaClicks: -p.clicks, deltaPct: p.clicks > 0 ? -1 : 0,
      });
    }
  }
  const decayingPages = pageChanges
    .filter((p) => p.prevClicks >= 5 && p.deltaPct <= -0.3)
    .sort((a, b) => a.deltaClicks - b.deltaClicks)
    .slice(0, 20);
  const growingPages = pageChanges
    .filter((p) => p.clicks >= 5 && p.deltaPct >= 0.3)
    .sort((a, b) => b.deltaClicks - a.deltaClicks)
    .slice(0, 20);

  // ---- rank trends (weekly, impression-weighted position) ----
  const totals = new Map<string, number>();
  for (const r of daily) totals.set(r.keys[1], (totals.get(r.keys[1]) ?? 0) + r.impressions);
  const topQueries = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([q]) => q);
  const topSet = new Set(topQueries);
  const buckets = new Map<string, Map<string, { w: number; pw: number; clicks: number }>>();
  for (const r of daily) {
    const q = r.keys[1];
    if (!topSet.has(q)) continue;
    const wk = mondayOf(r.keys[0]);
    const byWeek = buckets.get(q) ?? new Map();
    const b = byWeek.get(wk) ?? { w: 0, pw: 0, clicks: 0 };
    b.w += r.impressions;
    b.pw += r.position * r.impressions;
    b.clicks += r.clicks;
    byWeek.set(wk, b);
    buckets.set(q, byWeek);
  }
  const rankTrends: RankTrend[] = topQueries.map((q) => {
    const weeks = Array.from(buckets.get(q)?.entries() ?? [])
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([weekStart, b]) => ({
        weekStart,
        position: b.w > 0 ? Math.round((b.pw / b.w) * 10) / 10 : 0,
        clicks: b.clicks,
        impressions: b.w,
      }));
    const last = weeks[weeks.length - 1];
    return {
      query: q,
      impressions: totals.get(q) ?? 0,
      clicks: weeks.reduce((n, w) => n + w.clicks, 0),
      currentPosition: last?.position ?? 0,
      weeks,
    };
  });

  // ---- brand split ----
  const isBrand = (q: string) => brandTerms.some((t) => q.toLowerCase().includes(t));
  const brand = {
    terms: brandTerms,
    brandedClicks: 0,
    nonBrandedClicks: 0,
    brandedQueries: 0,
    nonBrandedQueries: 0,
  };
  for (const r of cur) {
    if (isBrand(r.keys[0])) {
      brand.brandedClicks += r.clicks;
      brand.brandedQueries += 1;
    } else {
      brand.nonBrandedClicks += r.clicks;
      brand.nonBrandedQueries += 1;
    }
  }

  return {
    configured: true,
    window: input.window,
    previousWindow: input.previousWindow,
    totalQueries: cur.length,
    brand,
    strikingDistance,
    lowCtr,
    rising,
    falling,
    newQueries,
    lostQueries,
    cannibalization: cannibalization.slice(0, 25),
    decayingPages,
    growingPages,
    rankTrends,
    rankedQueries: cur.map((r) => r.keys[0].toLowerCase()),
    pageQueries: (() => {
      const byPage = new Map<string, ScRow[]>();
      for (const r of queryPages) {
        const list = byPage.get(r.keys[1]) ?? [];
        list.push(r);
        byPage.set(r.keys[1], list);
      }
      return [...byPage.entries()]
        .map(([page, rows]) => ({
          page,
          clicks: rows.reduce((n, r) => n + r.clicks, 0),
          impressions: rows.reduce((n, r) => n + r.impressions, 0),
          queries: rows.sort((a, b) => b.impressions - a.impressions).slice(0, 6).map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
        }))
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 100);
    })(),
    topPages: [...pagesCur]
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10)
      .map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
    error: null,
  };
}

export const EMPTY_OPPORTUNITIES: Opportunities = {
  configured: false,
  window: null,
  previousWindow: null,
  totalQueries: 0,
  brand: { terms: [], brandedClicks: 0, nonBrandedClicks: 0, brandedQueries: 0, nonBrandedQueries: 0 },
  strikingDistance: [],
  lowCtr: [],
  rising: [],
  falling: [],
  newQueries: [],
  lostQueries: [],
  cannibalization: [],
  decayingPages: [],
  growingPages: [],
  rankTrends: [],
  rankedQueries: [],
  pageQueries: [],
  topPages: [],
  error: null,
};
