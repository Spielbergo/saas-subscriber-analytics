"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { seoFetch } from "@/lib/seoClient";
import { useDashboard } from "@/lib/DashboardContext";
import { useDateRange } from "@/lib/DateRangeContext";
import { DataTable } from "@/components/DataTable";
import { SeriesChart } from "@/components/SeriesChart";
import { CopyButton } from "@/components/CopyButton";
import { Card, ErrorNote, Mini, Notice, RunButton, col, num } from "@/components/seo/common";
import { goalProjection, kpis, mrrMovements, type MrrMovement } from "@/lib/trends";
import type { Annotation, Snapshot } from "@/lib/adminTypes";

type Resp = { snapshots: Snapshot[]; annotations: Annotation[]; durable: boolean };
const money = (n: number | null) => (n === null ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

export default function TrendsPage() {
  const { metrics } = useDashboard();
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { within, range } = useDateRange();
  const [annDay, setAnnDay] = useState(new Date().toISOString().slice(0, 10));
  const [annLabel, setAnnLabel] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await seoFetch<Resp>("/api/trends"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load trends");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function snapNow() {
    setBusy(true);
    try {
      await seoFetch("/api/snapshot", { method: "POST", body: JSON.stringify({ force: true }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Snapshot failed");
    }
    setBusy(false);
  }
  async function addAnn() {
    if (!annLabel.trim()) return;
    await seoFetch("/api/annotations", { method: "POST", body: JSON.stringify({ day: annDay, label: annLabel }) }).catch((e) => setError(String(e.message)));
    setAnnLabel("");
    load();
  }
  async function delAnn(id: string) {
    await seoFetch("/api/annotations", { method: "DELETE", body: JSON.stringify({ id }) }).catch(() => {});
    load();
  }

  const all = data?.snapshots ?? [];
  const snaps = useMemo(() => {
    return all.filter((s) => within(s.day));
  }, [all, within]);
  const rows = useMemo(() => snaps.map((s) => ({ day: s.day, ...flat(s) })), [snaps]);
  const mv = useMemo(() => mrrMovements(all), [all]);
  const k = useMemo(() => kpis(all), [all]);
  const goal = metrics?.mrrGoal ?? null;
  const proj = goal ? goalProjection(all, goal) : null;

  const report = () =>
    [
      "# NorthBooks trend history",
      `Snapshots: ${all.length} (${all[0]?.day ?? "-"} → ${all[all.length - 1]?.day ?? "-"})`,
      `ARPU ${money(k.arpu)} · monthly logo churn ${k.monthlyLogoChurn === null ? "n/a" : (k.monthlyLogoChurn * 100).toFixed(1) + "%"} · LTV ${money(k.ltv)}`,
      "",
      "day,mrr,paid,free,users,signups30,cancellations30,atRisk",
      ...all.map((s) => [s.day, s.data.mrr, s.data.paid, s.data.free, s.data.users, s.data.signups30, s.data.cancellations30, s.data.atRisk].join(",")),
      "",
      "Annotations: " + (data?.annotations.map((a) => `${a.day} ${a.label}`).join("; ") || "none"),
    ].join("\n");

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && !data.durable && (
        <Notice>
          Snapshots are being saved to a local file (<code className="font-mono text-xs">.seo-cache/</code>). Run{" "}
          <code className="font-mono text-xs">sql/admin_tables.sql</code> in the Supabase SQL editor to keep history permanently (needed on Vercel).
        </Notice>
      )}

      <Card
        title="Trends"
        subtitle="One snapshot per day is captured automatically when you open the dashboard (and by the daily cron on Vercel). History starts from the first snapshot."
        action={
          <div className="flex gap-2">
            <CopyButton label="Copy for AI" getText={report} />
            <RunButton onClick={snapNow} busy={busy}><Camera size={14} /> Snapshot now</RunButton>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Mini label="Snapshots" value={all.length} sub={all[0] ? `since ${all[0].day}` : "none yet"} />
          <Mini label="ARPU" value={money(k.arpu)} sub="per paying user / mo" />
          <Mini label="Logo churn" value={k.monthlyLogoChurn === null ? "—" : `${(k.monthlyLogoChurn * 100).toFixed(1)}%`} sub="monthly, trailing" tone={k.monthlyLogoChurn && k.monthlyLogoChurn > 0.08 ? "bad" : undefined} />
          <Mini label="Revenue churn" value={k.monthlyRevenueChurn === null ? "—" : `${(k.monthlyRevenueChurn * 100).toFixed(1)}%`} sub="monthly, trailing" />
          <Mini label="LTV" value={money(k.ltv)} sub="ARPU ÷ logo churn" />
          <Mini label="Net new MRR" value={money(k.netNewMrr30)} sub="per 30 days" tone={k.netNewMrr30 === null ? undefined : k.netNewMrr30 >= 0 ? "good" : "bad"} />
        </div>
        {all.length < 8 && <p className="mt-3 text-xs text-muted">Churn, LTV and net-new need about a week of snapshots to mean anything.</p>}
        <p className="mt-4 text-xs text-muted">Charts and tables below show {range.label.toLowerCase()} ({snaps.length} of {all.length} snapshots). Change it with the date range above. ARPU, churn and LTV always use trailing history.</p>
      </Card>

      {goal && proj && (
        <Card title="MRR goal">
          <div className="flex items-baseline justify-between text-sm">
            <span>{money(proj.current)} of {money(goal)}</span>
            <span className="text-muted">
              {proj.eta ? `on pace for ~${proj.eta}` : proj.perDay === null ? "need 7+ days of history to project" : proj.current >= goal ? "goal reached 🎉" : "not growing yet"}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(proj.pct * 100)}%` }} />
          </div>
        </Card>
      )}

      {snaps.length > 0 ? (
        <>
          <Card title="MRR" subtitle={snaps[snaps.length - 1].data.mrrSource === "helcim" ? "From Helcim (actual)." : "Estimated from plan prices."}>
            <SeriesChart data={rows} money annotations={data?.annotations} series={[{ key: "mrr", label: "MRR", color: "accent" }]} />
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Users">
              <SeriesChart data={rows} annotations={data?.annotations} series={[
                { key: "users", label: "Signups (total)", color: "muted" },
                { key: "paid", label: "Paid", color: "success" },
                { key: "free", label: "Free", color: "accent" },
              ]} />
            </Card>
            <Card title="Health">
              <SeriesChart data={rows} annotations={data?.annotations} series={[
                { key: "atRisk", label: "At risk", color: "warning" },
                { key: "cancellations30", label: "Cancellations (30d)", color: "danger" },
                { key: "building", label: "Set up + building", color: "accent" },
                { key: "activated", label: "Activated", color: "success" },
              ]} />
            </Card>
            <Card title="Traffic (GA4)">
              <SeriesChart data={rows} annotations={data?.annotations} series={[
                { key: "sessions", label: "Sessions (30d)", color: "accent" },
                { key: "keyEvents", label: "Key events", color: "success" },
              ]} />
            </Card>
            <Card title="Search (GSC)">
              <SeriesChart data={rows} annotations={data?.annotations} series={[
                { key: "clicks", label: "Clicks", color: "accent" },
                { key: "impressionsK", label: "Impressions (÷10)", color: "muted" },
              ]} />
            </Card>
          </div>
        </>
      ) : (
        data && <Notice>No snapshots yet — click “Snapshot now” to take the first one.</Notice>
      )}

      {mv.length > 0 && (
        <Card title="MRR movement" subtitle="Day-over-day change, derived from per-subscriber values in consecutive snapshots.">
          <DataTable<MrrMovement>
            rows={[...mv].filter((r) => within(r.day)).reverse()}
            rowKey={(r) => r.day}
            compact
            maxHeight={360}
            columns={[
              col<MrrMovement>("day", "Day", (r) => r.day),
              num<MrrMovement>("start", "Start", (r) => r.start, (r) => money(r.start)),
              num<MrrMovement>("new", "New", (r) => r.new, (r) => <span className="text-success">{r.new ? `+${money(r.new)}` : "—"}</span>),
              num<MrrMovement>("exp", "Expansion", (r) => r.expansion, (r) => <span className="text-success">{r.expansion ? `+${money(r.expansion)}` : "—"}</span>),
              num<MrrMovement>("con", "Contraction", (r) => r.contraction, (r) => <span className="text-warning">{r.contraction ? `-${money(r.contraction)}` : "—"}</span>),
              num<MrrMovement>("churn", "Churn", (r) => r.churn, (r) => <span className="text-danger">{r.churn ? `-${money(r.churn)}` : "—"}</span>),
              num<MrrMovement>("end", "End", (r) => r.end, (r) => money(r.end)),
            ]}
          />
        </Card>
      )}

      <Card title="Annotations" subtitle="Mark launches, posts and changes — they show as dashed lines on every chart.">
        <div className="flex flex-wrap gap-2">
          <input type="date" value={annDay} onChange={(e) => setAnnDay(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
          <input value={annLabel} onChange={(e) => setAnnLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addAnn()} placeholder="e.g. Reddit post, pricing change…" className="min-w-[14rem] flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm" />
          <RunButton onClick={addAnn}>Add</RunButton>
        </div>
        <ul className="mt-3 divide-y divide-border text-sm">
          {(data?.annotations ?? []).slice().reverse().map((a) => (
            <li key={a.id} className="flex items-center justify-between py-1.5">
              <span><span className="text-muted">{a.day}</span> · {a.label}</span>
              <button onClick={() => delAnn(a.id)} aria-label="Delete" className="text-muted hover:text-danger"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function flat(s: Snapshot) {
  const d = s.data;
  return {
    mrr: d.mrr, users: d.users, paid: d.paid, free: d.free, atRisk: d.atRisk, cancellations30: d.cancellations30,
    building: d.building, activated: d.activated ?? null,
    sessions: d.ga?.sessions ?? null, keyEvents: d.ga?.keyEvents ?? null,
    clicks: d.sc?.clicks ?? null, impressionsK: d.sc ? Math.round(d.sc.impressions / 10) : null,
  };
}
