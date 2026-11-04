"use client";

import { useState } from "react";
import { DataTable } from "@/components/DataTable";
import { seoFetch } from "@/lib/seoClient";
import type { Opportunities, PageSpeedResult } from "@/lib/seo/types";
import { Card, ErrorNote, Pill, RunButton, UrlLink, col, num } from "./common";

const score = (v: number | null) =>
  v === null ? <span className="text-muted">—</span> : <Pill tone={v >= 90 ? "good" : v >= 50 ? "warning" : "error"}>{v}</Pill>;
const sec = (ms: number | null) => (ms === null ? null : Math.round(ms / 100) / 10);

export function SpeedPanel({
  siteUrl,
  results,
  opportunities,
  hasKey,
  onChange,
}: {
  siteUrl: string | null;
  results: PageSpeedResult[];
  opportunities: Opportunities;
  hasKey: boolean;
  onChange: (rows: PageSpeedResult[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<"mobile" | "desktop">("mobile");

  async function run() {
    if (!siteUrl) return;
    setBusy(true);
    setError(null);
    const urls = [siteUrl, ...opportunities.topPages.slice(0, 4).map((p) => p.page)].filter(
      (u, i, a) => a.indexOf(u) === i
    );
    try {
      const r = await seoFetch<{ pagespeed: PageSpeedResult[] }>("/api/seo/pagespeed", {
        method: "POST",
        body: JSON.stringify({ urls, strategy }),
      });
      onChange(r.pagespeed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PageSpeed failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Core Web Vitals & speed"
        subtitle={`Google PageSpeed Insights (free) for your home page and top 4 Search Console pages. Takes ~20s per page.${hasKey ? "" : " No PAGESPEED_API_KEY set — works, but Google may rate-limit the shared quota."}`}
        action={
          <div className="flex items-center gap-2">
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as "mobile" | "desktop")}
              className="rounded-lg border border-border bg-bg px-2 py-1.5 text-xs"
              aria-label="Device"
            >
              <option value="mobile">Mobile</option>
              <option value="desktop">Desktop</option>
            </select>
            <RunButton onClick={run} busy={busy} disabled={!siteUrl}>
              {busy ? "Testing…" : "Run speed test"}
            </RunButton>
          </div>
        }
      >
        {error && <ErrorNote>{error}</ErrorNote>}
        {results.length === 0 && !busy && <p className="text-sm text-muted">No results yet.</p>}
        {results.length > 0 && (
          <DataTable<PageSpeedResult>
            rows={results}
            rowKey={(r) => `${r.strategy}|${r.url}`}
            compact
            filters={[{ key: "strategy", label: "Devices", getValue: (r) => r.strategy }]}
            columns={[
              col<PageSpeedResult>("url", "URL", (r) => r.url, (r) => <UrlLink url={r.url} max={40} />),
              col<PageSpeedResult>("strategy", "Device", (r) => r.strategy),
              num<PageSpeedResult>("perf", "Performance", (r) => r.performance, (r) => (r.error ? <Pill tone="error">error</Pill> : score(r.performance))),
              num<PageSpeedResult>("seo", "SEO", (r) => r.seo, (r) => score(r.seo)),
              num<PageSpeedResult>("a11y", "Accessibility", (r) => r.accessibility, (r) => score(r.accessibility)),
              num<PageSpeedResult>("bp", "Best practices", (r) => r.bestPractices, (r) => score(r.bestPractices)),
              num<PageSpeedResult>("lcp", "LCP (s)", (r) => sec(r.lcpMs), undefined, { firstDir: "asc" }),
              num<PageSpeedResult>("cls", "CLS", (r) => r.cls, (r) => <span className="text-muted">{r.cls === null ? "—" : r.cls.toFixed(3)}</span>, { firstDir: "asc" }),
              num<PageSpeedResult>("tbt", "TBT (ms)", (r) => (r.tbtMs === null ? null : Math.round(r.tbtMs)), undefined, { firstDir: "asc" }),
              col<PageSpeedResult>("field", "Real users", (r) => r.fieldCategory, (r) =>
                r.fieldCategory ? <Pill tone={r.fieldCategory === "FAST" ? "good" : r.fieldCategory === "AVERAGE" ? "warning" : "error"}>{r.fieldCategory.toLowerCase()}</Pill> : <span className="text-muted" title="Not enough Chrome-user traffic for field data">n/a</span>
              ),
            ]}
          />
        )}
        {results.some((r) => r.opportunities.length > 0) && (
          <div className="mt-5 border-t border-border pt-4">
            <h4 className="mb-2 text-sm font-medium">Biggest fixes</h4>
            <ul className="space-y-2 text-sm">
              {results
                .filter((r) => r.opportunities.length > 0)
                .map((r) => (
                  <li key={`${r.strategy}|${r.url}`}>
                    <UrlLink url={r.url} max={60} /> <span className="text-xs text-muted">({r.strategy})</span>
                    <ul className="mt-0.5 list-disc pl-5 text-muted">
                      {r.opportunities.map((o) => (
                        <li key={o.title}>
                          {o.title}
                          {o.savings && <span className="text-xs"> — {o.savings}</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
