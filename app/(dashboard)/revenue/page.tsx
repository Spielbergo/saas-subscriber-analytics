"use client";

import { useDashboard } from "@/lib/DashboardContext";
import { useDateRange } from "@/lib/DateRangeContext";
import { DataTable } from "@/components/DataTable";
import { CopyButton } from "@/components/CopyButton";
import { Card, Mini, Notice, Pill, col, num } from "@/components/seo/common";
import type { HelcimMonth, HelcimSubscription, HelcimTransaction, ReconIssue } from "@/lib/adminTypes";

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const KIND_LABEL: Record<string, string> = {
  no_helcim_subscription: "Paid in app, not in Helcim",
  status_mismatch: "Status mismatch",
  failed_payment: "Failed payment",
  billing_overdue: "Billing overdue",
  helcim_unmatched: "Helcim, no matching user",
};

export default function RevenuePage() {
  const { metrics } = useDashboard();
  const { within, range } = useDateRange();
  // Month rows ("YYYY-MM") count when any part of the month overlaps the range.
  const monthInRange = (m: string) => range.isAll || ((!range.from || m >= range.from.slice(0, 7)) && (!range.to || m <= range.to.slice(0, 7)));
  if (!metrics) return null;
  const h = metrics.helcim;

  if (!h.configured) {
    return (
      <Notice>
        Add <code className="font-mono text-xs">HELCIM_API_TOKEN</code> to <code className="font-mono text-xs">.env.local</code> and restart to see real revenue,
        failed payments and billing reconciliation. Create a token in Helcim → All Tools → Integrations → API Access Configuration with read access to
        Transaction Processing, Customers, Recurring/Payment Plans.
      </Notice>
    );
  }

  const diff = metrics.mrrActual !== null ? metrics.mrrActual - metrics.mrr : null;
  const report = () =>
    [
      "# Helcim revenue",
      `Actual MRR ${money(h.mrr)} vs estimate ${money(metrics.mrr)}; active ${h.activeCount}, failed ${h.failedPaymentCount}, paused ${h.pausedCount}, overdue ${h.overdueCount}`,
      `Last 30d: gross ${money(h.last30.gross)}, refunds ${money(h.last30.refunds)}, net ${money(h.last30.net)}, declined ${h.last30.declined}`,
      "",
      "## Reconciliation issues",
      ...(metrics.reconciliation.length
        ? metrics.reconciliation.map((r) => `- [${KIND_LABEL[r.kind]}] ${r.email ?? "?"}: ${r.detail}`)
        : ["none"]),
      ...(h.warnings.length ? ["", "## Warnings", ...h.warnings.map((w) => `- ${w}`)] : []),
    ].join("\n");

  return (
    <div className="flex flex-col gap-6">
      {h.error && <Notice>Helcim error: {h.error}</Notice>}
      {h.warnings.length > 0 && (
        <Notice>
          Some Helcim calls had trouble (field names are parsed defensively): {h.warnings.join(" · ")}
        </Notice>
      )}

      <Card title="Helcim" subtitle={`Fetched ${h.fetchedAt ? new Date(h.fetchedAt).toLocaleTimeString() : "—"} · cached 10 min`} action={<CopyButton label="Copy for AI" getText={report} />}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <Mini label="Actual MRR" value={money(h.mrr)} sub={diff === null ? "" : `${diff >= 0 ? "+" : "-"}${money(Math.abs(diff))} vs estimate`} />
          <Mini label="Active subs" value={h.activeCount} />
          <Mini label="Failed payments" value={h.failedPaymentCount} tone={h.failedPaymentCount ? "bad" : "good"} />
          <Mini label="Overdue billing" value={h.overdueCount} tone={h.overdueCount ? "warn" : "good"} />
          <Mini label="Paused" value={h.pausedCount} />
          <Mini label="Next 7 days" value={money(h.upcoming7d.amount)} sub={`${h.upcoming7d.count} billings`} />
          <Mini label="Gross (30d)" value={money(h.last30.gross)} />
          <Mini label="Refunds (30d)" value={money(h.last30.refunds)} />
          <Mini label="Net (30d)" value={money(h.last30.net)} tone="good" />
          <Mini label="Declines (30d)" value={h.last30.declined} tone={h.last30.declined ? "warn" : undefined} />
          <Mini label="Unmatched active" value={h.unmatchedActive} tone={h.unmatchedActive ? "warn" : "good"} sub="no user found" />
        </div>
      </Card>

      <Card title="Reconciliation" subtitle="Where Supabase and Helcim disagree.">
        <DataTable<ReconIssue>
          rows={metrics.reconciliation} viewsKey="revenue-reconciliation"
          rowKey={(r, i) => `${r.kind}|${r.userId ?? r.email}|${i}`}
          compact
          searchText={(r) => `${r.email ?? ""} ${r.name ?? ""} ${r.detail}`}
          filters={[{ key: "kind", label: "Issue types", getValue: (r) => KIND_LABEL[r.kind] }]}
          emptyMessage="Everything lines up."
          columns={[
            col<ReconIssue>("kind", "Issue", (r) => KIND_LABEL[r.kind], (r) => <Pill tone={r.kind === "failed_payment" ? "error" : "warning"}>{KIND_LABEL[r.kind]}</Pill>),
            col<ReconIssue>("who", "User", (r) => r.email ?? r.name ?? ""),
            col<ReconIssue>("detail", "Detail", (r) => r.detail, (r) => <span className="text-muted text-xs">{r.detail}</span>, { className: "min-w-[20rem]" }),
          ]}
        />
      </Card>

      <Card title="Subscriptions">
        <DataTable<HelcimSubscription>
          rows={h.subscriptions} viewsKey="revenue-subscriptions"
          rowKey={(r) => String(r.id)}
          compact
          maxHeight={420}
          searchText={(r) => `${r.customerName ?? ""} ${r.customerEmail ?? ""} ${r.planName ?? ""}`}
          filters={[
            { key: "status", label: "Statuses", getValue: (r) => r.status },
            { key: "match", label: "Matched", getValue: (r) => (r.matchedUserId ? "Matched" : "Unmatched"), options: ["Matched", "Unmatched"] },
          ]}
          initialSort={{ key: "next", dir: "asc" }}
          columns={[
            col<HelcimSubscription>("who", "Customer", (r) => r.customerName ?? r.customerEmail ?? ""),
            col<HelcimSubscription>("plan", "Plan", (r) => r.planName ?? ""),
            col<HelcimSubscription>("status", "Status", (r) => r.status, (r) => <Pill tone={r.status === "active" ? "good" : r.status === "paused" ? "warning" : "neutral"}>{r.status}</Pill>),
            num<HelcimSubscription>("amt", "Per month", (r) => r.monthlyAmount, (r) => money(r.monthlyAmount)),
            col<HelcimSubscription>("next", "Next billing", (r) => r.dateBilling ?? "", (r) => <span className="text-muted">{r.dateBilling?.slice(0, 10) ?? "—"}</span>, { firstDir: "asc" }),
            num<HelcimSubscription>("billed", "Times billed", (r) => r.timesBilled),
            col<HelcimSubscription>("fail", "Failed?", (r) => (r.hasFailedPayments ? "Yes" : "No"), (r) => (r.hasFailedPayments ? <Pill tone="error">failed</Pill> : <span className="text-muted">—</span>)),
            col<HelcimSubscription>("match", "Matched user", (r) => r.matchedBy ?? "", (r) => <span className="text-muted">{r.matchedBy ?? "no"}</span>),
          ]}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Revenue by month">
          <DataTable<HelcimMonth>
            rows={h.months.filter((r) => monthInRange(r.month))}
            rowKey={(r) => r.month}
            compact
            initialSort={{ key: "month", dir: "desc" }}
            columns={[
              col<HelcimMonth>("month", "Month", (r) => r.month, undefined, { firstDir: "desc" }),
              num<HelcimMonth>("gross", "Gross", (r) => r.gross, (r) => money(r.gross)),
              num<HelcimMonth>("refunds", "Refunds", (r) => r.refunds, (r) => money(r.refunds)),
              num<HelcimMonth>("net", "Net", (r) => r.net, (r) => money(r.net)),
              num<HelcimMonth>("declined", "Declined", (r) => r.declined),
            ]}
          />
        </Card>
        <Card title="Recent declines">
          <DataTable<HelcimTransaction>
            rows={h.recentDeclines.filter((r) => within(r.date))}
            rowKey={(r) => r.id}
            compact
            emptyMessage="No declines in the last 120 days."
            columns={[
              col<HelcimTransaction>("date", "Date", (r) => r.date, (r) => <span className="text-muted">{r.date.slice(0, 10)}</span>, { firstDir: "desc" }),
              col<HelcimTransaction>("cust", "Customer", (r) => r.customerCode ?? ""),
              num<HelcimTransaction>("amt", "Amount", (r) => r.amount, (r) => money(r.amount)),
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
