// Pure, client-safe diffs over the history.
import type { AuditSnap, BacklinkSnap, CwvPoint } from "./types";

export type IssueDiff = {
  code: string;
  prevCount: number;
  count: number;
  newUrls: string[] | null; // null = URL lists unavailable for one side
  fixedUrls: string[] | null;
};

export type AuditDiff = {
  prevAt: string;
  at: string;
  scoreDelta: number;
  errorsDelta: number;
  warningsDelta: number;
  issues: IssueDiff[]; // only codes whose count or URLs changed
  newIssueTypes: string[];
  resolvedIssueTypes: string[];
  newCount: number; // total newly-affected URLs
  fixedCount: number;
};

export function diffAudits(prev: AuditSnap, cur: AuditSnap): AuditDiff {
  const codes = new Set([...Object.keys(prev.counts), ...Object.keys(cur.counts)]);
  const issues: IssueDiff[] = [];
  let newCount = 0;
  let fixedCount = 0;
  const newTypes: string[] = [];
  const resolved: string[] = [];
  for (const code of codes) {
    const pc = prev.counts[code] ?? 0;
    const cc = cur.counts[code] ?? 0;
    const pu = prev.urls?.[code];
    const cu = cur.urls?.[code];
    let newUrls: string[] | null = null;
    let fixedUrls: string[] | null = null;
    if ((pu || pc === 0) && (cu || cc === 0)) {
      const ps = new Set(pu ?? []);
      const cs = new Set(cu ?? []);
      newUrls = (cu ?? []).filter((u) => !ps.has(u));
      fixedUrls = (pu ?? []).filter((u) => !cs.has(u));
      newCount += newUrls.length;
      fixedCount += fixedUrls.length;
    } else {
      newCount += Math.max(0, cc - pc);
      fixedCount += Math.max(0, pc - cc);
    }
    if (pc === 0 && cc > 0) newTypes.push(code);
    if (pc > 0 && cc === 0) resolved.push(code);
    if (pc !== cc || (newUrls && newUrls.length) || (fixedUrls && fixedUrls.length)) issues.push({ code, prevCount: pc, count: cc, newUrls, fixedUrls });
  }
  return {
    prevAt: prev.at, at: cur.at,
    scoreDelta: cur.score - prev.score,
    errorsDelta: cur.errors - prev.errors,
    warningsDelta: cur.warnings - prev.warnings,
    issues: issues.sort((a, b) => (b.count - b.prevCount) - (a.count - a.prevCount)),
    newIssueTypes: newTypes, resolvedIssueTypes: resolved,
    newCount, fixedCount,
  };
}

export type BacklinkDiff = {
  prevAt: string;
  at: string;
  totalDelta: number;
  newLinks: { source: string; target: string }[];
  lostLinks: { source: string; target: string }[];
  newDomains: string[];
  lostDomains: string[];
  linksComparable: boolean; // false if either side lacks the sampled link list
};

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const split = (s: string) => { const i = s.lastIndexOf("|"); return { source: s.slice(0, i), target: s.slice(i + 1) }; };

export function diffBacklinks(prev: BacklinkSnap, cur: BacklinkSnap): BacklinkDiff {
  const comparable = Boolean(prev.links && cur.links);
  const ps = new Set(prev.links ?? []);
  const cs = new Set(cur.links ?? []);
  const pd = new Set(prev.domains.map((d) => d.domain));
  const cd = new Set(cur.domains.map((d) => d.domain));
  return {
    prevAt: prev.at, at: cur.at,
    totalDelta: cur.totalLinks - prev.totalLinks,
    newLinks: comparable ? (cur.links ?? []).filter((l) => !ps.has(l)).map(split) : [],
    lostLinks: comparable ? (prev.links ?? []).filter((l) => !cs.has(l)).map(split) : [],
    newDomains: [...cd].filter((d) => !pd.has(d)),
    lostDomains: [...pd].filter((d) => !cd.has(d)),
    linksComparable: comparable,
  };
}

export { hostOf };

/** Chart rows (one per day, last reading wins) for one URL + strategy. */
export function cwvSeries(points: CwvPoint[], url: string, strategy: "mobile" | "desktop") {
  const byDay = new Map<string, CwvPoint>();
  for (const p of points.filter((x) => x.url === url && x.strategy === strategy).sort((a, b) => a.at.localeCompare(b.at))) {
    byDay.set(p.at.slice(0, 10), p);
  }
  return [...byDay.entries()].map(([day, p]) => ({
    day, performance: p.performance, seo: p.seo, accessibility: p.accessibility,
    lcpS: p.lcpMs === null ? null : Math.round(p.lcpMs / 100) / 10,
    tbtMs: p.tbtMs === null ? null : Math.round(p.tbtMs),
    clsX100: p.cls === null ? null : Math.round(p.cls * 1000) / 10,
    fieldLcpS: p.fieldLcpMs === null ? null : Math.round(p.fieldLcpMs / 100) / 10,
  }));
}
