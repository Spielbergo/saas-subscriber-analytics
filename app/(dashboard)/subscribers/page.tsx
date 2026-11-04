"use client";

import { SubscribersTable } from "@/components/SubscribersTable";
import { useMemo } from "react";
import { useDashboard } from "@/lib/DashboardContext";
import { useDateRange } from "@/lib/DateRangeContext";

export default function SubscribersPage() {
  const { metrics } = useDashboard();
  const { within, range } = useDateRange();
  const rows = useMemo(() => (metrics ? metrics.subscriberList.filter((r) => within(r.joinedAt)) : []), [metrics, within]);
  if (!metrics) return null;

  return (
    <>
    {!range.isAll && <p className="mb-3 text-xs text-muted">Showing {rows.length} of {metrics.subscriberList.length} people who joined in: {range.label.toLowerCase()}.</p>}
    <SubscribersTable
      rows={rows}
      loginCountsAvailable={metrics.loginCountsAvailable}
      attributionAvailable={metrics.attributionAvailable}
      usageAvailable={metrics.usageAvailable}
    />
    </>
  );
}
