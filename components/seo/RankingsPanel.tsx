"use client";

import { DataTable } from "@/components/DataTable";
import type { Opportunities, RankTrend } from "@/lib/seo/types";
import { Card, ErrorNote, Notice, PositionSpark, col, num, pos, signed } from "./common";

export function RankingsPanel({ data, configured }: { data: Opportunities; configured: boolean }) {
  if (!configured) return <Notice>Rank tracking uses Search Console data — connect it first.</Notice>;
  if (data.error) return <ErrorNote>{data.error}</ErrorNote>;

  const change = (r: RankTrend) => {
    const w = r.weeks;
    return w.length >= 2 ? Math.round((w[w.length - 1].position - w[0].position) * 10) / 10 : null;
  };

  return (
    <Card
      title="Rank tracker"
      subtitle="Your top 30 queries by impressions over the last ~90 days. Position is Google's average for each week, weighted by impressions. Lower is better; green means it's improving. Free and built from Search Console — no keyword list to maintain."
    >
      <DataTable<RankTrend>
        rows={data.rankTrends} viewsKey="seo-rankings"
        rowKey={(r) => r.query}
        compact
        searchText={(r) => r.query}
        initialSort={{ key: "impr", dir: "desc" }}
        emptyMessage="Not enough Search Console history yet."
        columns={[
          col<RankTrend>("query", "Query", (r) => r.query, (r) => <span className="font-medium">{r.query}</span>),
          num<RankTrend>("pos", "Position now", (r) => r.currentPosition, (r) => <span>{pos(r.currentPosition)}</span>, { firstDir: "asc" }),
          num<RankTrend>("change", "Change", (r) => change(r), (r) => {
            const c = change(r);
            if (c === null) return <span className="text-muted">—</span>;
            return <span className={c < 0 ? "text-success" : c > 0 ? "text-danger" : "text-muted"}>{signed(c, 1)}</span>;
          }, { firstDir: "asc" }),
          { key: "trend", header: "Trend (weekly)", cell: (r) => <PositionSpark values={r.weeks.map((w) => w.position)} /> },
          num<RankTrend>("clicks", "Clicks", (r) => r.clicks),
          num<RankTrend>("impr", "Impressions", (r) => r.impressions),
        ]}
      />
    </Card>
  );
}
