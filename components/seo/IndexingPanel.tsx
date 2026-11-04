"use client";

import { useState } from "react";
import { DataTable } from "@/components/DataTable";
import { seoFetch } from "@/lib/seoClient";
import type { CrawlResult, InspectionResult } from "@/lib/seo/types";
import { Card, ErrorNote, Mini, Notice, Pill, RunButton, UrlLink, col } from "./common";

export function IndexingPanel({
  inspections,
  crawl,
  configured,
  onChange,
}: {
  inspections: InspectionResult[];
  crawl: CrawlResult | null;
  configured: boolean;
  onChange: (rows: InspectionResult[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await seoFetch<{ inspections: InspectionResult[] }>("/api/seo/inspect", {
        method: "POST",
        body: JSON.stringify({}),
      });
      onChange(r.inspections);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inspection failed");
    } finally {
      setBusy(false);
    }
  }

  const ok = inspections.filter((i) => i.verdict === "PASS").length;
  const bad = inspections.filter((i) => !i.error && i.verdict !== "PASS").length;
  const indexableByCrawl = new Set((crawl?.pages ?? []).filter((p) => p.indexable).map((p) => p.url));
  const shouldBeIndexed = inspections.filter((i) => indexableByCrawl.has(i.url) && i.verdict !== "PASS" && !i.error).length;
  const last = inspections.map((i) => i.inspectedAt).sort().pop();

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Index coverage"
        subtitle="Asks Google, via the free URL Inspection API, whether each page is actually indexed (up to 60 pages per run; Google allows ~2,000/day). Uses the indexable pages from your last site audit."
        action={
          <RunButton onClick={run} busy={busy} disabled={!configured || !crawl}>
            {busy ? "Inspecting…" : inspections.length ? "Re-inspect pages" : "Inspect pages"}
          </RunButton>
        }
      >
        {!configured && <Notice>Needs the Search Console service account (see <code className="font-mono text-xs">docs/marketing-setup.md</code>).</Notice>}
        {configured && !crawl && <p className="text-sm text-muted">Run a site audit first — it supplies the list of pages to inspect.</p>}
        {error && <ErrorNote>{error}</ErrorNote>}
        {inspections.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Inspected" value={inspections.length} sub={last ? `last ${new Date(last).toLocaleString()}` : undefined} />
            <Mini label="Indexed (PASS)" value={ok} tone="good" />
            <Mini label="Not indexed / issues" value={bad} tone={bad ? "warn" : "good"} />
            <Mini label="Should be indexed" value={shouldBeIndexed} tone={shouldBeIndexed ? "bad" : "good"} sub="crawl says indexable, Google disagrees" />
          </div>
        )}
      </Card>

      {inspections.length > 0 && (
        <Card title="Pages">
          <DataTable<InspectionResult>
            rows={inspections}
            rowKey={(r) => r.url}
            compact
            maxHeight={520}
            searchText={(r) => `${r.url} ${r.coverageState ?? ""}`}
            filters={[
              { key: "verdict", label: "Verdicts", getValue: (r) => r.verdict ?? "Error" },
              { key: "coverage", label: "Coverage states", getValue: (r) => r.coverageState },
            ]}
            columns={[
              col<InspectionResult>("url", "URL", (r) => r.url, (r) => <UrlLink url={r.url} />),
              col<InspectionResult>("verdict", "Verdict", (r) => r.verdict ?? "", (r) =>
                r.error ? <Pill tone="error">error</Pill> : <Pill tone={r.verdict === "PASS" ? "good" : r.verdict === "FAIL" ? "error" : "warning"}>{r.verdict ?? "—"}</Pill>
              ),
              col<InspectionResult>("coverage", "Coverage", (r) => r.coverageState ?? r.error, (r) => (
                <span title={r.error ?? ""} className={r.error ? "text-danger" : "text-muted"}>{r.coverageState ?? r.error ?? "—"}</span>
              ), { className: "max-w-xs truncate" }),
              col<InspectionResult>("crawl", "Last crawled", (r) => (r.lastCrawlTime ? new Date(r.lastCrawlTime).getTime() : null), (r) => (
                <span className="text-muted">{r.lastCrawlTime ? new Date(r.lastCrawlTime).toLocaleDateString() : "never"}</span>
              ), { firstDir: "desc" }),
              col<InspectionResult>("canon", "Google-chosen canonical", (r) => r.googleCanonical, (r) => {
                const differs = r.googleCanonical && r.userCanonical && r.googleCanonical !== r.userCanonical;
                return r.googleCanonical ? <span className={differs ? "text-warning" : "text-muted"} title={r.googleCanonical}>{differs ? "differs from yours" : "matches"}</span> : <span className="text-muted">—</span>;
              }),
            ]}
          />
        </Card>
      )}
    </div>
  );
}
