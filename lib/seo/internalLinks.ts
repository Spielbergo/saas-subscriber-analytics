// Pure: suggest internal links from relevant, well-linked pages to pages
// that get search impressions but have few internal links pointing at them.
import type { CrawlPage, CrawlResult, Opportunities } from "./types";

const STOP = new Set("a an and are as at be by for from how i in is it of on or our that the this to we what when where which who why with you your can do does vs best top get use using free online new".split(" "));

export const tokens = (s: string): string[] =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

const pathOf = (u: string) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };
const keyOf = (u: string) => { const p = pathOf(u); return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p; };

export type LinkSuggestion = {
  target: string;
  title: string | null;
  impressions: number;
  clicks: number;
  inlinks: number;
  topQuery: string;
  queries: string[];
  sources: { url: string; title: string | null; inlinks: number; matched: string[]; score: number }[];
};

export function internalLinkSuggestions(crawl: CrawlResult | null, opp: Opportunities, brandTerms: string[] = [], limit = 25): { items: LinkSuggestion[]; reason: string | null } {
  if (!crawl) return { items: [], reason: "Run a site audit first — it maps which pages link to which." };
  if (!opp.configured || opp.pageQueries.length === 0) return { items: [], reason: "Needs Search Console data to know which pages deserve more links." };
  const hasLinks = crawl.pages.some((p) => p.outlinks);
  if (!hasLinks) return { items: [], reason: "Re-run the site audit — the last crawl didn't record link targets." };

  const byKey = new Map<string, CrawlPage>();
  for (const p of crawl.pages) byKey.set(keyOf(p.url), p);
  const usable = (p: CrawlPage) => p.indexable && p.status === 200;
  const brand = new Set(brandTerms.flatMap(tokens));
  const inl = crawl.pages.filter(usable).map((p) => p.inlinks).sort((a, b) => a - b);
  const medianInlinks = inl.length ? inl[Math.floor(inl.length / 2)] : 0;

  const items: LinkSuggestion[] = [];
  for (const pq of opp.pageQueries) {
    const target = byKey.get(keyOf(pq.page));
    if (!target || !usable(target)) continue;
    // "Under-linked": fewer internal links than most pages, or just very few.
    if (target.inlinks > Math.max(3, medianInlinks)) continue;
    const weighted = new Map<string, number>();
    for (const q of pq.queries) for (const t of tokens(q.query)) if (!brand.has(t)) weighted.set(t, (weighted.get(t) ?? 0) + q.impressions);
    for (const t of tokens(`${target.title ?? ""} ${target.h1.join(" ")}`)) if (!brand.has(t)) weighted.set(t, (weighted.get(t) ?? 0) + 1);
    if (weighted.size === 0) continue;
    const targetPath = keyOf(target.url);

    const cands = crawl.pages
      .filter((p) => usable(p) && p.url !== target.url && !(p.outlinks ?? []).some((o) => keyOf(o) === targetPath))
      .map((p) => {
        const hay = new Set(tokens(`${p.title ?? ""} ${p.h1.join(" ")} ${p.metaDescription ?? ""} ${pathOf(p.url).replace(/[-_/]/g, " ")}`));
        const matched = [...weighted.keys()].filter((t) => hay.has(t));
        const rel = matched.reduce((n, t) => n + Math.log2(2 + (weighted.get(t) ?? 0)), 0);
        return { p, matched, score: rel * (1 + Math.log2(1 + p.inlinks) / 4) };
      })
      .filter((c) => c.matched.length > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
    if (!cands.length) continue;
    items.push({
      target: target.url,
      title: target.title,
      impressions: pq.impressions,
      clicks: pq.clicks,
      inlinks: target.inlinks,
      topQuery: pq.queries[0]?.query ?? "",
      queries: pq.queries.slice(0, 4).map((q) => q.query),
      sources: cands.map((c) => ({ url: c.p.url, title: c.p.title, inlinks: c.p.inlinks, matched: c.matched.slice(0, 5), score: Math.round(c.score * 10) / 10 })),
    });
  }
  items.sort((a, b) => b.impressions - a.impressions);
  return { items: items.slice(0, limit), reason: items.length ? null : "No under-linked pages with a clear topical match found." };
}
