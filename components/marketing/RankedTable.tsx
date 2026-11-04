"use client";

import { DataTable, type Column } from "@/components/DataTable";

// Shared table shape for Search Console's top-queries and top-pages
// reports — same four metric columns, different label column.
export type RankedRow = {
  label: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export function RankedTable({
  rows,
  labelHeader,
  emptyMessage,
}: {
  rows: RankedRow[];
  labelHeader: string;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted">{emptyMessage}</p>;
  }

  const columns: Column<RankedRow>[] = [
    {
      key: "label",
      header: labelHeader,
      sortValue: (r) => r.label.toLowerCase(),
      copy: (r) => r.label,
      className: "max-w-xs truncate",
      cell: (r) => <span title={r.label}>{r.label}</span>,
    },
    {
      key: "clicks",
      header: "Clicks",
      firstDir: "desc",
      sortValue: (r) => r.clicks,
      cell: (r) => <span className="text-muted">{r.clicks}</span>,
    },
    {
      key: "impressions",
      header: "Impressions",
      firstDir: "desc",
      sortValue: (r) => r.impressions,
      cell: (r) => <span className="text-muted">{r.impressions}</span>,
    },
    {
      key: "ctr",
      header: "CTR",
      firstDir: "desc",
      sortValue: (r) => r.ctr,
      cell: (r) => (
        <span className="text-muted">{(r.ctr * 100).toFixed(1)}%</span>
      ),
    },
    {
      key: "position",
      header: "Avg. position",
      // Lower position number = better ranking, so best-first is ascending.
      sortValue: (r) => r.position,
      cell: (r) => <span className="text-muted">{r.position.toFixed(1)}</span>,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.label}
      compact
      searchText={(r) => r.label}
      searchPlaceholder={`Filter ${labelHeader.toLowerCase()}s…`}
      initialSort={{ key: "clicks", dir: "desc" }}
    />
  );
}
