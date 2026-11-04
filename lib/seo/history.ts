import "server-only";
import { kvGet, kvSet, tableMissing } from "../adminStore";
import type { AuditSnap, BacklinkData, BacklinkSnap, CrawlResult, CwvPoint, PageSpeedResult, SeoHistory } from "./types";

// Stored as JSON documents in admin_kv (falls back to .seo-cache/ files).
const AUDITS = "seo_audit_history";
const CWV = "seo_cwv_history";
const LINKS = "seo_backlink_history";

const KEEP_AUDITS = 60;
const KEEP_AUDIT_URLS = 6; // only the newest N audits keep their URL lists
const MAX_URLS_PER_ISSUE = 150;

export function snapFromCrawl(c: CrawlResult): AuditSnap {
  const counts: Record<string, number> = {};
  const urls: Record<string, string[]> = {};
  for (const i of c.issues) {
    counts[i.code] = i.urls.length;
    urls[i.code] = i.urls.slice(0, MAX_URLS_PER_ISSUE);
  }
  const sum = (sev: string) => c.issues.filter((i) => i.severity === sev).reduce((n, i) => n + i.urls.length, 0);
  return { at: c.finishedAt, score: c.score, pages: c.pagesCrawled, errors: sum("error"), warnings: sum("warning"), notices: sum("notice"), counts, urls };
}

export async function recordAudit(c: CrawlResult): Promise<void> {
  const all = await kvGet<AuditSnap[]>(AUDITS, []);
  if (all.some((a) => a.at === c.finishedAt)) return;
  all.push(snapFromCrawl(c));
  const trimmed = all.slice(-KEEP_AUDITS).map((a, i, arr) => (i >= arr.length - KEEP_AUDIT_URLS ? a : { ...a, urls: undefined }));
  await kvSet(AUDITS, trimmed);
}

export const cwvPoint = (r: PageSpeedResult): CwvPoint => ({
  at: r.fetchedAt, url: r.url, strategy: r.strategy,
  performance: r.performance, seo: r.seo, accessibility: r.accessibility, bestPractices: r.bestPractices,
  lcpMs: r.lcpMs, cls: r.cls, tbtMs: r.tbtMs, fieldLcpMs: r.fieldLcpMs, fieldCls: r.fieldCls, fieldInpMs: r.fieldInpMs,
});

export async function recordPageSpeed(results: PageSpeedResult[]): Promise<void> {
  const ok = results.filter((r) => !r.error && r.performance !== null);
  if (!ok.length) return;
  const all = await kvGet<CwvPoint[]>(CWV, []);
  all.push(...ok.map(cwvPoint));
  await kvSet(CWV, all.slice(-800));
}

export function snapFromBacklinks(b: BacklinkData): BacklinkSnap {
  return {
    at: b.fetchedAt ?? new Date().toISOString(),
    totalLinks: b.totalLinks,
    targets: b.targets.slice(0, 40),
    domains: b.referringDomains.slice(0, 60),
    links: b.samples.filter((s) => s.source).map((s) => `${s.source}|${s.target}`).slice(0, 300),
  };
}

export async function recordBacklinks(b: BacklinkData): Promise<void> {
  if (!b.configured || b.error || !b.fetchedAt) return;
  const all = await kvGet<BacklinkSnap[]>(LINKS, []);
  if (all.some((x) => x.at === b.fetchedAt)) return;
  all.push(snapFromBacklinks(b));
  await kvSet(LINKS, all.slice(-40).map((x, i, arr) => (i >= arr.length - 4 ? x : { ...x, links: undefined })));
}

export async function getSeoHistory(): Promise<SeoHistory> {
  const [audits, cwv, backlinks] = await Promise.all([
    kvGet<AuditSnap[]>(AUDITS, []),
    kvGet<CwvPoint[]>(CWV, []),
    kvGet<BacklinkSnap[]>(LINKS, []),
  ]);
  return { audits, cwv, backlinks, durable: !tableMissing("admin_kv") };
}
