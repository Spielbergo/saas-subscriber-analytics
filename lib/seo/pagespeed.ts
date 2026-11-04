import { readCache, writeCache } from "./store";
import { recordPageSpeed } from "./history";
import type { PageSpeedResult } from "./types";

type Audit = { numericValue?: number; score?: number | null; title?: string; displayValue?: string; details?: { type?: string; overallSavingsMs?: number } };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (v: unknown) => (typeof v === "number" ? Math.round(v * 100) : null);

/** Pure: turn a PageSpeed Insights v5 response into our flat result. */
export function parsePageSpeed(url: string, strategy: "mobile" | "desktop", json: any): PageSpeedResult {
  const lh = json?.lighthouseResult;
  const audits: Record<string, Audit> = lh?.audits ?? {};
  const cats = lh?.categories ?? {};
  const field = json?.loadingExperience?.metrics ?? {};
  const cls = field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;

  const opportunities = Object.values(audits)
    .filter((a) => a.details?.type === "opportunity" && typeof a.score === "number" && a.score < 0.9)
    .sort((a, b) => (b.details?.overallSavingsMs ?? 0) - (a.details?.overallSavingsMs ?? 0))
    .slice(0, 6)
    .map((a) => ({ title: a.title ?? "", savings: a.displayValue ?? null }));

  return {
    url,
    strategy,
    fetchedAt: new Date().toISOString(),
    performance: pct(cats.performance?.score),
    seo: pct(cats.seo?.score),
    accessibility: pct(cats.accessibility?.score),
    bestPractices: pct(cats["best-practices"]?.score),
    lcpMs: num(audits["largest-contentful-paint"]?.numericValue),
    fcpMs: num(audits["first-contentful-paint"]?.numericValue),
    tbtMs: num(audits["total-blocking-time"]?.numericValue),
    cls: num(audits["cumulative-layout-shift"]?.numericValue),
    speedIndexMs: num(audits["speed-index"]?.numericValue),
    fieldLcpMs: num(field.LARGEST_CONTENTFUL_PAINT_MS?.percentile),
    fieldCls: typeof cls === "number" ? cls / 100 : null,
    fieldInpMs: num(field.INTERACTION_TO_NEXT_PAINT?.percentile),
    fieldCategory: json?.loadingExperience?.overall_category ?? null,
    opportunities,
    error: null,
  };
}

export function getPageSpeedCache(): PageSpeedResult[] {
  return readCache<PageSpeedResult[]>("pagespeed.json", []);
}

export async function runPageSpeed(
  urls: string[],
  strategy: "mobile" | "desktop"
): Promise<PageSpeedResult[]> {
  const key = process.env.PAGESPEED_API_KEY;
  const results: PageSpeedResult[] = [];
  for (const url of urls.slice(0, 8)) {
    const params = new URLSearchParams({ url, strategy });
    for (const c of ["performance", "seo", "accessibility", "best-practices"]) params.append("category", c);
    if (key) params.set("key", key);
    try {
      const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, {
        signal: AbortSignal.timeout(90_000),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? `PageSpeed API returned ${res.status}`);
      }
      results.push(parsePageSpeed(url, strategy, json));
    } catch (err) {
      results.push({
        url, strategy, fetchedAt: new Date().toISOString(),
        performance: null, seo: null, accessibility: null, bestPractices: null,
        lcpMs: null, fcpMs: null, tbtMs: null, cls: null, speedIndexMs: null,
        fieldLcpMs: null, fieldCls: null, fieldInpMs: null, fieldCategory: null,
        opportunities: [],
        error: err instanceof Error ? err.message : "PageSpeed request failed",
      });
    }
  }

  // Merge into the cache: newest result wins per url+strategy. Don't
  // overwrite a good cached result with a failed one.
  const cache = getPageSpeedCache();
  const keyOf = (r: PageSpeedResult) => `${r.strategy}|${r.url}`;
  const merged = new Map(cache.map((r) => [keyOf(r), r]));
  for (const r of results) {
    if (r.error && merged.has(keyOf(r))) continue;
    merged.set(keyOf(r), r);
  }
  writeCache("pagespeed.json", Array.from(merged.values()));
  await recordPageSpeed(results).catch(() => {});
  return results;
}
