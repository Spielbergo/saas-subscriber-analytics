"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { useDashboard } from "@/lib/DashboardContext";
import { seoFetch } from "@/lib/seoClient";
import { CRM_STAGES } from "@/lib/adminTypes";
import type { SubscriberRow } from "@/lib/metrics";
import { CopyButton } from "@/components/CopyButton";
import { DataTable } from "@/components/DataTable";
import { Card, Notice, col, num, pct } from "@/components/seo/common";
import { useCrm } from "@/components/crm/CrmContext";
import { OutreachMenu } from "@/components/crm/OutreachMenu";
import { CHECKPOINTS, cohortRetention, type CohortRow } from "@/lib/cohorts";
import { mrrOf } from "@/lib/growth";

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// ---------- Pipeline ----------
function Pipeline() {
  const { metrics } = useDashboard();
  const crm = useCrm();
  const [showEmpty, setShowEmpty] = useState(false);
  const cols = useMemo(() => {
    if (!metrics) return [];
    const by = new Map<string, SubscriberRow[]>();
    for (const r of metrics.subscriberList) {
      const { stage } = crm.stageOf(r);
      if (stage === "ignore" && !showEmpty) continue;
      (by.get(stage) ?? by.set(stage, []).get(stage)!).push(r);
    }
    return CRM_STAGES.filter((s) => s.id !== "ignore" || showEmpty).map((s) => ({ ...s, rows: (by.get(s.id) ?? []).sort((a, b) => b.joinedAt.localeCompare(a.joinedAt)) }));
  }, [metrics, crm, showEmpty]);
  if (!metrics) return null;
  const text = () => cols.map((c) => `## ${c.label} (${c.rows.length})\n${c.rows.slice(0, 40).map((r) => `- ${r.fullName ?? r.email} · ${r.plan ?? "no plan"} · joined ${r.joinedAt.slice(0, 10)}`).join("\n")}`).join("\n\n");
  return (
    <Card
      title="Pipeline"
      subtitle="Stage is worked out automatically (lead → trial → customer; at risk and churned come from the data). Set a stage by hand in a person's drawer to override it."
      action={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> show “Ignore”</label>
          <CopyButton label="Copy" getText={text} />
        </div>
      }
    >
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cols.filter((c) => c.id !== "partner" || c.rows.length > 0).map((c) => (
          <div key={c.id} className="flex min-w-0 flex-col rounded-xl border border-border bg-surface-2/40">
            <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-medium">{c.label}</span>
              <span className="text-xs text-muted">{c.rows.length}{c.id === "customer" ? ` · ${money(c.rows.reduce((n, r) => n + mrrOf(r, metrics.planPricing), 0))}/mo` : ""}</span>
            </div>
            <ul className="flex max-h-96 flex-col gap-1.5 overflow-y-auto p-2">
              {c.rows.length === 0 && <li className="px-1 py-2 text-xs text-muted">Nobody here.</li>}
              {c.rows.map((r) => {
                const f = crm.contacts.get(r.id)?.followUpOn;
                return (
                  <li key={r.id}>
                    <button onClick={() => crm.open(r.id)} className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-left text-sm hover:border-accent">
                      <span className="block truncate font-medium">{r.fullName || r.email}</span>
                      <span className="block truncate text-xs text-muted">{r.companyNames[0] ?? r.email}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                        <span className="capitalize">{r.plan ?? "free"}</span>
                        {r.usage && <span>{r.usage.invoices} inv</span>}
                        {f && <span className="inline-flex items-center gap-0.5 text-warning"><CalendarClock size={11} />{f.slice(5)}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------- Follow-ups ----------
function FollowUps() {
  const { metrics } = useDashboard();
  const crm = useCrm();
  if (!metrics) return null;
  const today = new Date().toISOString().slice(0, 10);
  const rows = metrics.subscriberList.filter((r) => crm.contacts.get(r.id)?.followUpOn).sort((a, b) => (crm.contacts.get(a.id)!.followUpOn! < crm.contacts.get(b.id)!.followUpOn! ? -1 : 1));
  return (
    <Card title="Follow-ups" subtitle="People you scheduled a follow-up for. Overdue ones are highlighted.">
      <DataTable<SubscriberRow>
        rows={rows} viewsKey="crm-followups"
        rowKey={(r) => r.id}
        compact
        onRowClick={(r) => crm.open(r.id)}
        emptyMessage="No follow-ups scheduled — open someone's detail and pick a date."
        columns={[
          col<SubscriberRow>("due", "Due", (r) => crm.contacts.get(r.id)?.followUpOn ?? "", (r) => { const f = crm.contacts.get(r.id)!.followUpOn!; return <span className={f <= today ? "font-medium text-warning" : "text-muted"}>{f}{f < today ? " · overdue" : f === today ? " · today" : ""}</span>; }, { firstDir: "asc" }),
          col<SubscriberRow>("who", "Who", (r) => r.fullName ?? r.email ?? ""),
          col<SubscriberRow>("plan", "Plan", (r) => r.plan ?? ""),
          col<SubscriberRow>("tags", "Tags", (r) => (crm.contacts.get(r.id)?.tags ?? []).join(", ")),
          col<SubscriberRow>("note", "Latest note", (r) => crm.notesFor(r.id)[0]?.body ?? "", (r) => <span className="line-clamp-1 max-w-md text-xs text-muted">{crm.notesFor(r.id)[0]?.body ?? "—"}</span>),
          { key: "reach", header: "", cell: (r) => <OutreachMenu row={r} compact /> },
        ]}
      />
    </Card>
  );
}

// ---------- Cohorts ----------
function Cohorts() {
  const { metrics } = useDashboard();
  const [days, setDays] = useState<Record<string, string[]> | null>(null);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    seoFetch<{ available: boolean; days: Record<string, string[]> }>("/api/login-days")
      .then((r) => { setAvailable(r.available); setDays(r.days); })
      .catch(() => setAvailable(false));
  }, []);
  const rows = useMemo(() => (metrics && days ? cohortRetention(metrics.subscriberList, days) : []), [metrics, days]);
  if (!metrics) return null;
  const text = () =>
    `Cohort retention (share of each signup-week cohort that logged in during week N after signup):\nweek | size | ${CHECKPOINTS.map((n) => `W${n}`).join(" | ")}\n` +
    rows.map((r) => `${r.week} | ${r.size} | ${CHECKPOINTS.map((n) => (r.retained[n] ? `${r.retained[n]!.n}/${pct(r.retained[n]!.pct, 0)}` : "-")).join(" | ")}`).join("\n");
  return (
    <Card
      title="Cohort retention"
      subtitle="Of the people who signed up in a given week, how many logged in during week 1, 2, 4 and 8 afterwards. “—” means that cohort isn't old enough yet."
      action={<CopyButton label="Copy" getText={text} />}
    >
      {!available ? (
        <Notice>Needs login history. Run <code className="font-mono text-xs">sql/crm_data.sql</code> in the Supabase SQL editor (it adds a locked-down function that reads Supabase’s auth log). Supabase only keeps that log for a limited time, so old logins may be missing.</Notice>
      ) : (
        <DataTable<CohortRow>
          rows={rows}
          rowKey={(r) => r.week}
          compact
          maxHeight={420}
          initialSort={{ key: "week", dir: "desc" }}
          emptyMessage="No cohorts yet."
          csvName="cohort-retention"
          columns={[
            col<CohortRow>("week", "Signup week", (r) => r.week, undefined, { firstDir: "desc" }),
            num<CohortRow>("size", "Signups", (r) => r.size),
            ...CHECKPOINTS.map((n) =>
              num<CohortRow>(`w${n}`, `Week ${n}`, (r) => r.retained[n]?.pct ?? null, (r) => {
                const c = r.retained[n];
                if (!c) return <span className="text-muted">—</span>;
                const a = Math.round(8 + c.pct * 40);
                return (
                  <span className="inline-block min-w-[4.5rem] rounded px-2 py-0.5 text-center text-xs" style={{ background: `rgb(var(--accent) / ${a / 100})` }} title={`${c.n} of cohort active`}>
                    {pct(c.pct, 0)} <span className="text-muted">({c.n})</span>
                  </span>
                );
              })
            ),
          ]}
        />
      )}
    </Card>
  );
}

// ---------- Adoption ----------
function Adoption() {
  const { metrics } = useDashboard();
  if (!metrics) return null;
  const a = metrics.adoption;
  if (!a) {
    return (
      <Card title="Feature adoption">
        <Notice>Needs invoice and usage data. Run <code className="font-mono text-xs">sql/crm_data.sql</code> in the Supabase SQL editor — it counts invoices, clients, time entries, expenses and bank statements per user without pulling the raw data out of the database.</Notice>
      </Card>
    );
  }
  const items: [string, number][] = [
    ["Activated (any core task)", a.activated], ["Created an invoice", a.withInvoice], ["Sent an invoice", a.withSentInvoice], ["Got an invoice paid", a.withPaidInvoice],
    ["Added a client", a.withClient], ["Logged time", a.withTimeEntry], ["Tracked an expense", a.withExpense],
    ["Uploaded a bank statement", a.withBankStatement], ["Uses recurring items", a.withRecurring],
  ];
  const text = () => `Feature adoption (${a.users} users): ` + items.map(([l, n]) => `${l} ${n} (${pct(n / (a.users || 1), 0)})`).join("; ") + `. ${a.totalInvoices} invoices totalling ${money(a.totalInvoiced)}; median days to first invoice: ${a.medianDaysToFirstInvoice ?? "n/a"}.`;
  return (
    <Card title="Feature adoption" subtitle={`Share of ${a.users} users who have used each feature. “Activated” = created an invoice, tracked an expense or uploaded a bank statement. ${a.totalInvoices} invoices created (${money(a.totalInvoiced)} invoiced)${a.medianDaysToFirstInvoice !== null ? ` · median ${a.medianDaysToFirstInvoice} days from signup to first invoice` : ""}.`} action={<CopyButton label="Copy" getText={text} />}>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map(([label, n]) => (
          <li key={label}>
            <div className="flex justify-between text-sm"><span>{label}</span><span className="text-muted">{n} · {pct(n / (a.users || 1), 0)}</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${(n / (a.users || 1)) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function CrmPage() {
  const { metrics } = useDashboard();
  if (!metrics) return null;
  return (
    <div className="flex flex-col gap-6">
      <Pipeline />
      <FollowUps />
      <Adoption />
      <Cohorts />
    </div>
  );
}
