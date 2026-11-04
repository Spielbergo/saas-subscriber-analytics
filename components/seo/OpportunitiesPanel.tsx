"use client";

import { DataTable } from "@/components/DataTable";
import type {
  Cannibalization,
  Opportunities,
  PageChange,
  QueryChange,
  QueryOpportunity,
  QueryStat,
} from "@/lib/seo/types";
import { Card, ErrorNote, Mini, Notice, UrlLink, col, num, pct, pos, signed } from "./common";

const queryCols = <T extends QueryStat>() => [
  col<T>("query", "Query", (r) => r.query, (r) => <span className="font-medium">{r.query}</span>, { className: "max-w-xs truncate" }),
  num<T>("clicks", "Clicks", (r) => r.clicks),
  num<T>("impr", "Impressions", (r) => r.impressions),
  num<T>("ctr", "CTR", (r) => r.ctr, (r) => <span className="text-muted">{pct(r.ctr)}</span>),
  num<T>("pos", "Avg. pos", (r) => r.position, (r) => <span className="text-muted">{pos(r.position)}</span>, { firstDir: "asc" }),
];

export function OpportunitiesPanel({ data, configured }: { data: Opportunities; configured: boolean }) {
  if (!configured) {
    return (
      <Notice>
        Keyword opportunities come from Search Console. Connect it first — see <code className="font-mono text-xs">docs/marketing-setup.md</code>.
      </Notice>
    );
  }
  if (data.error) return <ErrorNote>Search Console error: {data.error}</ErrorNote>;

  const brandShare = data.brand.brandedClicks + data.brand.nonBrandedClicks > 0
    ? data.brand.brandedClicks / (data.brand.brandedClicks + data.brand.nonBrandedClicks)
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="Queries (28d)" value={data.totalQueries.toLocaleString()} sub={data.window ? `${data.window.startDate} → ${data.window.endDate}` : undefined} />
        <Mini label="Striking distance" value={data.strikingDistance.length} sub="position 8–20" />
        <Mini label="Branded clicks" value={pct(brandShare, 0)} sub={`${data.brand.brandedClicks} branded · ${data.brand.nonBrandedClicks} non-branded`} />
        <Mini label="Cannibalization" value={data.cannibalization.length} sub="queries split across pages" />
      </div>

      <Card
        title="Striking distance"
        subtitle="Queries you rank 8–20 for. A small push (better title, internal links, more depth) can move these onto page one. “Extra clicks” estimates the gain from reaching ~position 3."
      >
        <DataTable<QueryOpportunity>
          rows={data.strikingDistance} viewsKey="seo-striking"
          rowKey={(r) => r.query}
          compact
          searchText={(r) => `${r.query} ${r.page ?? ""}`}
          initialSort={{ key: "extra", dir: "desc" }}
          emptyMessage="No queries in positions 8–20 yet."
          columns={[
            ...queryCols<QueryOpportunity>(),
            num<QueryOpportunity>("extra", "Extra clicks", (r) => r.estimatedExtraClicks, (r) => <span className="text-success">+{r.estimatedExtraClicks}</span>),
            col<QueryOpportunity>("page", "Ranking page", (r) => r.page, (r) => (r.page ? <UrlLink url={r.page} max={40} /> : <span className="text-muted">—</span>)),
          ]}
        />
      </Card>

      <Card
        title="Low click-through rate"
        subtitle="You rank on page one but get fewer clicks than that position normally earns — usually a title/description problem."
      >
        <DataTable<QueryOpportunity>
          rows={data.lowCtr} viewsKey="seo-low-ctr"
          rowKey={(r) => r.query}
          compact
          searchText={(r) => `${r.query} ${r.page ?? ""}`}
          initialSort={{ key: "extra", dir: "desc" }}
          emptyMessage="No obvious CTR gaps."
          columns={[
            ...queryCols<QueryOpportunity>(),
            num<QueryOpportunity>("extra", "Missed clicks", (r) => r.estimatedExtraClicks, (r) => <span className="text-warning">+{r.estimatedExtraClicks}</span>),
            col<QueryOpportunity>("page", "Ranking page", (r) => r.page, (r) => (r.page ? <UrlLink url={r.page} max={40} /> : <span className="text-muted">—</span>)),
          ]}
        />
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChangeCard title="Rising queries" subtitle="More clicks than the previous 28 days." rows={data.rising} />
        <ChangeCard title="Falling queries" subtitle="Fewer clicks than the previous 28 days." rows={data.falling} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="New queries" subtitle="Appeared this period, none last period.">
          <DataTable<QueryStat>
            rows={data.newQueries}
            rowKey={(r) => r.query}
            compact
            emptyMessage="Nothing new."
            columns={queryCols<QueryStat>()}
          />
        </Card>
        <Card title="Lost queries" subtitle="Had impressions last period, none this period.">
          <DataTable<QueryStat>
            rows={data.lostQueries}
            rowKey={(r) => r.query}
            compact
            emptyMessage="Nothing lost."
            columns={queryCols<QueryStat>()}
          />
        </Card>
      </div>

      <Card
        title="Keyword cannibalization"
        subtitle="Queries where two or more of your pages compete. Consider merging them or making one clearly canonical for that topic."
      >
        <DataTable<Cannibalization>
          rows={data.cannibalization}
          rowKey={(r) => r.query}
          compact
          searchText={(r) => r.query}
          emptyMessage="No competing pages found."
          columns={[
            col<Cannibalization>("query", "Query", (r) => r.query, (r) => <span className="font-medium">{r.query}</span>),
            num<Cannibalization>("impr", "Impressions", (r) => r.totalImpressions),
            num<Cannibalization>("pages", "Pages", (r) => r.pages.length),
            col<Cannibalization>(
              "detail",
              "Competing pages (clicks · impressions · position)",
              (r) => r.pages.length,
              (r) => (
                <ul className="space-y-0.5 py-1">
                  {r.pages.map((p) => (
                    <li key={p.page} className="flex items-center gap-2">
                      <UrlLink url={p.page} max={45} />
                      <span className="text-xs text-muted">
                        {p.clicks} · {p.impressions} · {pos(p.position)}
                      </span>
                    </li>
                  ))}
                </ul>
              ),
              { className: "min-w-[20rem]" }
            ),
          ]}
        />
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <PageChangeCard title="Content decay" subtitle="Pages whose clicks dropped 30%+ vs the previous 28 days — refresh or re-promote them." rows={data.decayingPages} tone="down" />
        <PageChangeCard title="Growing pages" subtitle="Pages gaining clicks — see what's working." rows={data.growingPages} tone="up" />
      </div>
    </div>
  );
}

function ChangeCard({ title, subtitle, rows }: { title: string; subtitle: string; rows: QueryChange[] }) {
  return (
    <Card title={title} subtitle={subtitle}>
      <DataTable<QueryChange>
        rows={rows}
        rowKey={(r) => r.query}
        compact
        emptyMessage="Nothing to show."
        columns={[
          col<QueryChange>("query", "Query", (r) => r.query, (r) => <span className="font-medium">{r.query}</span>, { className: "max-w-[14rem] truncate" }),
          num<QueryChange>("clicks", "Clicks", (r) => r.clicks, (r) => <span className="text-muted">{r.clicks} <span className="text-xs">(was {r.prevClicks})</span></span>),
          num<QueryChange>("delta", "Δ clicks", (r) => r.deltaClicks, (r) => (
            <span className={r.deltaClicks >= 0 ? "text-success" : "text-danger"}>{signed(r.deltaClicks)}</span>
          )),
          num<QueryChange>("pos", "Position", (r) => r.position, (r) => (
            <span className="text-muted">
              {pos(r.position)}
              {r.deltaPosition !== null && r.deltaPosition !== 0 && (
                <span className={`ml-1 text-xs ${r.deltaPosition < 0 ? "text-success" : "text-danger"}`}>
                  ({signed(r.deltaPosition, 1)})
                </span>
              )}
            </span>
          ), { firstDir: "asc" }),
        ]}
      />
    </Card>
  );
}

function PageChangeCard({ title, subtitle, rows, tone }: { title: string; subtitle: string; rows: PageChange[]; tone: "up" | "down" }) {
  return (
    <Card title={title} subtitle={subtitle}>
      <DataTable<PageChange>
        rows={rows}
        rowKey={(r) => r.page}
        compact
        emptyMessage="Nothing to show."
        columns={[
          col<PageChange>("page", "Page", (r) => r.page, (r) => <UrlLink url={r.page} max={40} />),
          num<PageChange>("clicks", "Clicks", (r) => r.clicks, (r) => <span className="text-muted">{r.clicks} <span className="text-xs">(was {r.prevClicks})</span></span>),
          num<PageChange>("pct", "Change", (r) => r.deltaPct, (r) => (
            <span className={tone === "up" ? "text-success" : "text-danger"}>
              {signed(r.deltaPct * 100)}%
            </span>
          ), { firstDir: tone === "up" ? "desc" : "asc" }),
        ]}
      />
    </Card>
  );
}
