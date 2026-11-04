"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Bell, Eye, Mail, RefreshCw, Send } from "lucide-react";
import { seoFetch } from "@/lib/seoClient";
import { DataTable } from "@/components/DataTable";
import { SeriesChart } from "@/components/SeriesChart";
import { CopyButton } from "@/components/CopyButton";
import { Card, ErrorNote, Mini, Notice, Pill, RunButton, col } from "@/components/seo/common";
import type { CertInfo, DomainInfo, MonitorStatus, NotificationLogItem, TargetStatus } from "@/lib/adminTypes";

type Digest = { subject: string; text: string; attention: number; sent: boolean };
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(v === 1 ? 0 : 2)}%`);
const daysTone = (d: number | null, warn: number) => (d === null ? "neutral" : d <= 7 ? "bad" : d <= warn ? "warn" : "good");

export default function OperationsPage() {
  const [st, setSt] = useState<MonitorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setSt(await seoFetch<MonitorStatus>("/api/monitor")); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load monitor"); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  async function act(action: string) {
    setBusy(action); setMsg(null);
    try {
      const r = await seoFetch<{ status?: MonitorStatus; digest?: Digest; notification?: NotificationLogItem }>("/api/monitor", { method: "POST", body: JSON.stringify({ action }) });
      if (r.status) setSt(r.status); else await load();
      if (r.digest) setDigest(r.digest);
      if (r.notification) setMsg(r.notification.error ?? `Sent via ${r.notification.channels.join(" + ")}`);
      if (action === "digest-send") setMsg("Digest sent (see the log below).");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  if (!st) return error ? <ErrorNote>{error}</ErrorNote> : <p className="text-sm text-muted">Loading…</p>;

  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!st.configured && <Notice>Set <code>SEO_SITE_URL</code> or <code>MONITOR_URLS</code> (comma-separated, e.g. your marketing site and app) to start monitoring.</Notice>}
      {!st.durable && <Notice>Checks are stored in a local file. Run <code>sql/admin_tables.sql</code> in Supabase so history survives deploys.</Notice>}

      <Card
        title="Uptime"
        subtitle={`Last check ${st.lastRunAt ? new Date(st.lastRunAt).toLocaleTimeString() : "never"}. Checks run while this tab is open, daily from cron, and as often as you point an external pinger at /api/cron/monitor.`}
        action={<RunButton onClick={() => act("run")} busy={busy === "run"}><RefreshCw size={14} /> Check now</RunButton>}
      >
        <div className="flex flex-col gap-5">
          {st.targets.map((t) => <TargetCard key={t.url} t={t} />)}
        </div>
      </Card>

      <Card title="SSL certificates & domain renewals" subtitle={`Alerts start at ${st.thresholds.sslDays} days (SSL) and ${st.thresholds.domainDays} days (domain).`}
        action={<RunButton onClick={() => act("refresh")} busy={busy === "refresh"}><RefreshCw size={14} /> Re-check</RunButton>}>
        <div className="flex flex-col gap-4">
          <DataTable<CertInfo> rows={st.certs} rowKey={(r) => r.host} compact csvName="ssl-certificates" emptyMessage="No hosts"
            columns={[
              col<CertInfo>("host", "Host", (r) => r.host),
              col<CertInfo>("left", "Days left", (r) => r.daysLeft ?? 9999, (r) => <Pill tone={daysTone(r.daysLeft, st.thresholds.sslDays)}>{r.daysLeft === null ? "unknown" : `${r.daysLeft}d`}</Pill>),
              col<CertInfo>("to", "Expires", (r) => r.validTo ?? "", (r) => r.validTo?.slice(0, 10) ?? "—"),
              col<CertInfo>("iss", "Issuer", (r) => r.issuer ?? ""),
              col<CertInfo>("ok", "Trusted", (r) => (r.authorized ? 1 : 0), (r) => (r.authorized ? "yes" : <span className="text-danger">{r.error ?? "no"}</span>)),
            ]} />
          <DataTable<DomainInfo> rows={st.domains} rowKey={(r) => r.domain} compact csvName="domain-expiry" emptyMessage="No domains"
            columns={[
              col<DomainInfo>("d", "Domain", (r) => r.domain),
              col<DomainInfo>("left", "Days left", (r) => r.daysLeft ?? 9999, (r) => r.error && r.daysLeft === null ? <span className="text-xs text-warning">{r.error}</span> : <Pill tone={daysTone(r.daysLeft, st.thresholds.domainDays)}>{r.daysLeft}d</Pill>),
              col<DomainInfo>("e", "Expires", (r) => r.expires ?? "", (r) => r.expires?.slice(0, 10) ?? "—"),
              col<DomainInfo>("r", "Registrar", (r) => r.registrar ?? ""),
              col<DomainInfo>("s", "Source", (r) => r.source ?? "", (r) => r.source ?? "—"),
            ]} />
        </div>
      </Card>

      <Card title="Alerts & daily digest"
        subtitle="Alerts fire once when something breaks, escalate as deadlines get closer, remind while still broken, and tell you when it's resolved.">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <Pill tone={st.channels.slack ? "good" : "neutral"}><Bell size={11} className="mr-1 inline" />Slack {st.channels.slack ? "on" : "off"}</Pill>
          <Pill tone={st.channels.email ? "good" : "neutral"}><Mail size={11} className="mr-1 inline" />Email {st.channels.email ? "on" : "off"}</Pill>
          {!st.channels.slack && !st.channels.email && <span className="text-xs text-muted">Set <code>SLACK_WEBHOOK_URL</code> and/or <code>RESEND_API_KEY</code> + <code>ALERT_EMAIL_TO</code> + <code>ALERT_EMAIL_FROM</code>.</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <RunButton onClick={() => act("test")} busy={busy === "test"}><Send size={14} /> Send test alert</RunButton>
          <RunButton onClick={() => act("digest-preview")} busy={busy === "digest-preview"}><Eye size={14} /> Preview digest</RunButton>
          <RunButton onClick={() => act("digest-send")} busy={busy === "digest-send"}><Activity size={14} /> Send digest now</RunButton>
        </div>
        {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
        {digest && (
          <div className="mt-3 rounded-xl border border-border bg-bg p-4">
            <div className="mb-2 flex items-center justify-between gap-2"><p className="text-sm font-medium">{digest.subject}</p><CopyButton getText={() => digest.text} label="Copy" /></div>
            <pre className="whitespace-pre-wrap text-xs text-muted">{digest.text}</pre>
          </div>
        )}
        <div className="mt-4">
          <DataTable<NotificationLogItem> rows={st.notifications} rowKey={(r) => r.at + r.title} compact maxHeight={320} csvName="notification-log" emptyMessage="Nothing sent yet"
            columns={[
              col<NotificationLogItem>("at", "When", (r) => r.at, (r) => new Date(r.at).toLocaleString(), { firstDir: "desc" }),
              col<NotificationLogItem>("k", "Type", (r) => r.kind, (r) => <Pill tone={r.severity === "critical" ? "bad" : r.severity === "warning" ? "warn" : "neutral"}>{r.kind}</Pill>),
              col<NotificationLogItem>("t", "Message", (r) => r.title),
              col<NotificationLogItem>("c", "Delivered", (r) => r.channels.join(","), (r) => (r.error ? <span className="text-xs text-warning">{r.error}</span> : r.channels.join(" + "))),
            ]} />
        </div>
      </Card>
    </>
  );
}

function TargetCard({ t }: { t: TargetStatus }) {
  const up = t.last?.ok;
  const data = t.recent.map((r) => ({ day: r.at.slice(5, 16).replace("T", " "), latency: r.ok ? r.latencyMs : null }));
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Pill tone={t.last === null ? "neutral" : up ? "good" : "bad"}>{t.last === null ? "no data" : up ? "UP" : "DOWN"}</Pill><span className="text-sm font-medium break-all">{t.url}</span></div>
        {t.last && !up && <span className="text-xs text-danger">{t.last.detail}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="Uptime 24h" value={pct(t.uptime24h)} sub={`${t.checks24h} checks`} tone={t.uptime24h !== null && t.uptime24h < 0.99 ? "bad" : undefined} />
        <Mini label="Uptime 7d" value={pct(t.uptime7d)} />
        <Mini label="Uptime 30d" value={pct(t.uptime30d)} />
        <Mini label="Avg response 24h" value={t.avgLatency24h === null ? "—" : `${t.avgLatency24h} ms`} tone={t.avgLatency24h && t.avgLatency24h > 2000 ? "warn" : undefined} />
      </div>
      {data.length > 1 && <div className="mt-3"><SeriesChart data={data} series={[{ key: "latency", label: "Response (ms)", color: "accent" }]} height={160} /></div>}
    </div>
  );
}
