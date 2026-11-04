"use client";

import { useMemo, useState } from "react";
import { SeriesChart } from "@/components/SeriesChart";
import { CopyButton } from "@/components/CopyButton";
import { DataTable } from "@/components/DataTable";
import { cwvSeries, diffAudits, diffBacklinks, type IssueDiff } from "@/lib/seo/diff";
import type { SeoBundle } from "@/lib/seo/types";
import { Card, Mini, Notice, Pill, UrlLink, col, num } from "./common";

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const path = (u: string) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };

export function HistoryPanel({ bundle }: { bundle: SeoBundle }) {
  const h = bundle.history;
  const labelOf = (code: string) => bundle.crawl?.issues.find((i) => i.code === code)?.label ?? code.replace(/_/g, " ");
  const audits = h?.audits ?? [];
  const diff = useMemo(() => (audits.length >= 2 ? diffAudits(audits[audits.length - 2], audits[audits.length - 1]) : null), [audits]);
  const [open, setOpen] = useState<string | null>(null);

  const combos = useMemo(() => {
    const seen = new Map<string, { url: string; strategy: "mobile" | "desktop" }>();
    for (const p of h?.cwv ?? []) seen.set(`${p.strategy}|${p.url}`, { url: p.url, strategy: p.strategy });
    return [...seen.entries()];
  }, [h]);
  const [combo, setCombo] = useState<string>("");
  const chosen = combo || combos[0]?.[0] || "";
  const sel = combos.find(([k]) => k === chosen)?.[1];
  const series = useMemo(() => (sel ? cwvSeries(h?.cwv ?? [], sel.url, sel.strategy) : []), [h, sel]);

  const links = h?.backlinks ?? [];
  const bdiff = useMemo(() => (links.length >= 2 ? diffBacklinks(links[links.length - 2], links[links.length - 1]) : null), [links]);

  const aiText = () =>
    [
      "# SEO changes since the previous audit",
      diff ? `Score ${signed(diff.scoreDelta)} (${audits[audits.length - 2].score} → ${audits[audits.length - 1].score}); errors ${signed(diff.errorsDelta)}, warnings ${signed(diff.warningsDelta)}; ${diff.newCount} newly affected URLs, ${diff.fixedCount} fixed.` : "Not enough audits yet.",
      ...(diff?.issues ?? []).map((i) => `- ${labelOf(i.code)}: ${i.prevCount} → ${i.count}${i.newUrls?.length ? `\n  new: ${i.newUrls.slice(0, 8).map(path).join(", ")}` : ""}${i.fixedUrls?.length ? `\n  fixed: ${i.fixedUrls.slice(0, 8).map(path).join(", ")}` : ""}`),
    ].join("\n");

  if (!h) return <Notice>History isn’t available yet — reload the SEO data.</Notice>;

  return (
    <div className="flex flex-col gap-6">
      {!h.durable && (
        <Notice>
          History is saved to a local file. Run <code className="font-mono text-xs">sql/admin_tables.sql</code> in Supabase to keep it permanently (needed on Vercel).
          A weekly audit runs automatically on Vercel via <code className="font-mono text-xs">/api/cron/seo</code> (needs <code className="font-mono text-xs">CRON_SECRET</code>); locally, just re-run the audit now and then.
        </Notice>
      )}

      <Card
        title="Audit history"
        subtitle="Every finished site audit is saved. Compare any two runs to see what you broke and what you fixed."
        action={<CopyButton label="Copy changes for AI" getText={aiText} />}
      >
        {audits.length === 0 ? (
          <p className="text-sm text-muted">No audits recorded yet — run a site audit and it will appear here.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Mini label="Latest score" value={audits[audits.length - 1].score} sub={diff ? `${signed(diff.scoreDelta)} vs previous` : `${audits.length} audit`} tone={diff ? (diff.scoreDelta >= 0 ? "good" : "bad") : undefined} />
              <Mini label="New problems" value={diff?.newCount ?? "—"} tone={diff && diff.newCount ? "warn" : undefined} sub="URLs newly affected" />
              <Mini label="Fixed" value={diff?.fixedCount ?? "—"} tone={diff && diff.fixedCount ? "good" : undefined} sub="URLs no longer affected" />
              <Mini label="Audits saved" value={audits.length} sub={`since ${audits[0].at.slice(0, 10)}`} />
            </div>
            {audits.length > 1 && (
              <div className="mt-4">
                <SeriesChart
                  height={200}
                  data={audits.map((a) => ({ day: a.at.slice(0, 10), score: a.score, errors: a.errors, warnings: a.warnings }))}
                  series={[
                    { key: "score", label: "Health score", color: "success" },
                    { key: "errors", label: "Errors", color: "danger" },
                    { key: "warnings", label: "Warnings", color: "warning" },
                  ]}
                />
              </div>
            )}
            {diff && (
              <div className="mt-5">
                <h4 className="mb-2 text-sm font-medium">
                  Changes: {diff.prevAt.slice(0, 10)} → {diff.at.slice(0, 10)}
                  {diff.newIssueTypes.length > 0 && <span className="ml-2 text-warning">{diff.newIssueTypes.length} new issue type{diff.newIssueTypes.length > 1 ? "s" : ""}</span>}
                  {diff.resolvedIssueTypes.length > 0 && <span className="ml-2 text-success">{diff.resolvedIssueTypes.length} fully resolved</span>}
                </h4>
                <DataTable<IssueDiff>
                  rows={diff.issues}
                  rowKey={(r) => r.code}
                  compact
                  onRowClick={(r) => setOpen(open === r.code ? null : r.code)}
                  selectedKey={open}
                  emptyMessage="Nothing changed between the last two audits."
                  columns={[
                    col<IssueDiff>("issue", "Issue", (r) => labelOf(r.code)),
                    num<IssueDiff>("prev", "Before", (r) => r.prevCount),
                    num<IssueDiff>("now", "Now", (r) => r.count),
                    num<IssueDiff>("delta", "Change", (r) => r.count - r.prevCount, (r) => <span className={r.count > r.prevCount ? "text-danger" : r.count < r.prevCount ? "text-success" : "text-muted"}>{signed(r.count - r.prevCount)}</span>),
                    num<IssueDiff>("new", "New URLs", (r) => r.newUrls?.length ?? null),
                    num<IssueDiff>("fixed", "Fixed URLs", (r) => r.fixedUrls?.length ?? null),
                  ]}
                />
                {open && (() => {
                  const d = diff.issues.find((i) => i.code === open);
                  if (!d) return null;
                  return (
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      <div>
                        <h5 className="mb-1 text-xs font-medium text-danger">Newly affected ({d.newUrls?.length ?? "?"})</h5>
                        <ul className="space-y-0.5 text-xs">{(d.newUrls ?? []).slice(0, 40).map((u) => <li key={u}><UrlLink url={u} max={70} /></li>)}{d.newUrls === null && <li className="text-muted">URL lists weren’t saved for the older audit.</li>}</ul>
                      </div>
                      <div>
                        <h5 className="mb-1 text-xs font-medium text-success">Fixed ({d.fixedUrls?.length ?? "?"})</h5>
                        <ul className="space-y-0.5 text-xs">{(d.fixedUrls ?? []).slice(0, 40).map((u) => <li key={u}><UrlLink url={u} max={70} /></li>)}</ul>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </Card>

      <Card title="Core Web Vitals history" subtitle="Every PageSpeed run is saved (and the weekly job adds one for your home page). LCP in seconds, CLS ×100, so everything fits on one chart.">
        {combos.length === 0 ? (
          <p className="text-sm text-muted">No speed runs recorded yet — run PageSpeed on the Speed tab.</p>
        ) : (
          <>
            <select value={chosen} onChange={(e) => setCombo(e.target.value)} className="mb-3 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs">
              {combos.map(([k, v]) => <option key={k} value={k}>{v.strategy} · {path(v.url) || "/"}</option>)}
            </select>
            {series.length < 2 ? <p className="text-sm text-muted">Only one reading so far — a trend needs at least two runs on different days.</p> : (
              <div className="grid gap-4 lg:grid-cols-2">
                <SeriesChart height={200} data={series} series={[{ key: "performance", label: "Performance", color: "accent" }, { key: "seo", label: "SEO", color: "success" }, { key: "accessibility", label: "Accessibility", color: "muted" }]} />
                <SeriesChart height={200} data={series} series={[{ key: "lcpS", label: "LCP (s)", color: "warning" }, { key: "clsX100", label: "CLS ×100", color: "danger" }, { key: "fieldLcpS", label: "Field LCP (s)", color: "muted" }]} />
              </div>
            )}
          </>
        )}
      </Card>

      <Card title="Backlink changes" subtitle="Bing snapshots compared over time. Link-level changes cover the sampled links only (your top linked pages), so treat them as a floor.">
        {links.length === 0 ? (
          <p className="text-sm text-muted">No backlink snapshots yet — fetch backlinks on the Backlinks tab.</p>
        ) : links.length === 1 ? (
          <p className="text-sm text-muted">One snapshot so far ({links[0].at.slice(0, 10)}, {links[0].totalLinks} links). Refresh again later to see new and lost links.</p>
        ) : bdiff && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Mini label="Total links" value={links[links.length - 1].totalLinks} sub={`${signed(bdiff.totalDelta)} since ${bdiff.prevAt.slice(0, 10)}`} tone={bdiff.totalDelta >= 0 ? "good" : "bad"} />
              <Mini label="New links" value={bdiff.linksComparable ? bdiff.newLinks.length : "—"} tone={bdiff.newLinks.length ? "good" : undefined} />
              <Mini label="Lost links" value={bdiff.linksComparable ? bdiff.lostLinks.length : "—"} tone={bdiff.lostLinks.length ? "bad" : undefined} />
              <Mini label="Referring domains" value={`+${bdiff.newDomains.length} / −${bdiff.lostDomains.length}`} />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <h5 className="mb-1 text-xs font-medium text-success">New</h5>
                <ul className="space-y-0.5 text-xs">{bdiff.newLinks.slice(0, 30).map((l, i) => <li key={i}><UrlLink url={l.source} max={55} /> <span className="text-muted">→ {path(l.target) || "/"}</span></li>)}{bdiff.newLinks.length === 0 && <li className="text-muted">None{!bdiff.linksComparable ? " (older snapshot has no link list)" : ""}.</li>}</ul>
                {bdiff.newDomains.length > 0 && <p className="mt-2 text-xs text-muted">New domains: {bdiff.newDomains.join(", ")}</p>}
              </div>
              <div>
                <h5 className="mb-1 text-xs font-medium text-danger">Lost</h5>
                <ul className="space-y-0.5 text-xs">{bdiff.lostLinks.slice(0, 30).map((l, i) => <li key={i}><UrlLink url={l.source} max={55} /> <span className="text-muted">→ {path(l.target) || "/"}</span></li>)}{bdiff.lostLinks.length === 0 && <li className="text-muted">None.</li>}</ul>
                {bdiff.lostDomains.length > 0 && <p className="mt-2 text-xs text-muted">Lost domains: {bdiff.lostDomains.join(", ")}</p>}
              </div>
            </div>
            {links.length > 2 && (
              <div className="mt-4"><SeriesChart height={180} data={links.map((l) => ({ day: l.at.slice(0, 10), total: l.totalLinks }))} series={[{ key: "total", label: "Total links", color: "accent" }]} /></div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
