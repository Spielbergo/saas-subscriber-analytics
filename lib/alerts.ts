import "server-only";
import { kvGet, kvSet } from "./adminStore";
import { getMetrics } from "./metrics";
import { listSnapshots } from "./snapshots";
import { listCrm } from "./crmStore";
import { getMentions } from "./mentions";
import { getOpportunities } from "./seo/searchConsoleSeo";
import { getSeoHistory } from "./seo/history";
import { diffAudits } from "./seo/diff";
import { todayLocal } from "./dates";
import { getMonitorStatus, runMonitor, thresholds } from "./monitor";
import { notify } from "./notify";
import { applyDedupe, buildDigest, infraCandidates, type AlertCandidate, type AlertState, type DigestInput } from "./ops";

const stateKey = "alert_state";

async function dispatch(sendList: AlertCandidate[], resolved: { title: string; since: string }[]) {
  for (const c of sendList) await notify({ kind: "alert", severity: c.severity, title: c.title, body: c.body });
  for (const r of resolved) {
    const mins = Math.max(1, Math.round((Date.now() - new Date(r.since).getTime()) / 60_000));
    const dur = mins >= 120 ? `${Math.round(mins / 60)}h` : `${mins} min`;
    await notify({ kind: "resolved", severity: "info", title: `✅ Resolved: ${r.title.replace(/^[^\w]+/u, "")}`, body: `Was active for about ${dur}.` });
  }
}

/** Run checks, then alert on anything new/escalated. Safe to call every 5–10 minutes. */
export async function runInfraAlerts(opts: { minIntervalSec?: number } = {}) {
  const run = await runMonitor(opts);
  const st = await getMonitorStatus();
  const cands = infraCandidates(st.targets, st.certs, st.domains, thresholds());
  const prev = await kvGet<AlertState>(stateKey, {});
  const r = applyDedupe(cands, prev, "infra");
  await kvSet(stateKey, r.state);
  await dispatch(r.send, r.resolved);
  return { ran: run.ran, checks: run.checks.length, alerts: r.send.length, resolved: r.resolved.length, active: cands.length };
}

const pii = () => process.env.ALERT_INCLUDE_PII !== "false";

/** Build the digest (and, unless preview, send it and update de-dupe state). */
export async function runDailyDigest(opts: { send: boolean }) {
  const [m, snaps, crm, mon, history, opp, mentions] = await Promise.all([
    getMetrics(),
    listSnapshots(5).catch(() => ({ snapshots: [] as { day: string; data: { mrr: number } }[] })),
    listCrm().catch(() => ({ contacts: [], notes: [], durable: false })),
    getMonitorStatus(),
    getSeoHistory().catch(() => undefined),
    getOpportunities().catch(() => null),
    getMentions().catch(() => null),
  ]);
  const today = todayLocal(process.env.DASHBOARD_TZ);
  const lastAt = await kvGet<string | null>("digest_last_at", null);
  const since = lastAt ? new Date(lastAt).getTime() : Date.now() - 86_400_000;
  const name = (s: { id: string; fullName: string | null; email: string | null }) => (pii() ? s.fullName || s.email || `user ${s.id.slice(0, 6)}` : `user ${s.id.slice(0, 6)}`);

  // Business alerts → candidates, de-duplicated so an old problem isn't repeated daily.
  const cands: AlertCandidate[] = [];
  for (const s of m.subscriberList) {
    if (s.helcimFailed) cands.push({ key: `pay:${s.id}`, family: "biz", severity: "critical", remindEveryHours: 168, notifyResolved: false, title: "", body: "", bucket: undefined });
    if (s.renewalOverdueDays && s.renewalOverdueDays > 0) cands.push({ key: `overdue:${s.id}`, family: "biz", severity: "warning", remindEveryHours: 168, title: "", body: "" });
  }
  // fill in text
  for (const c of cands) {
    const id = c.key.split(":")[1];
    const s = m.subscriberList.find((x) => x.id === id)!;
    c.title = c.key.startsWith("pay:") ? `Failed Helcim payment — ${name(s)}${s.plan ? ` (${s.plan})` : ""}` : `Renewal ${s.renewalOverdueDays}d overdue — ${name(s)}${s.plan ? ` (${s.plan})` : ""}`;
    c.body = c.title;
  }
  const audits = history?.audits ?? [];
  let seo: DigestInput["seo"] = null;
  if (audits.length) {
    const cur = audits[audits.length - 1];
    const prev = audits[audits.length - 2];
    seo = { score: cur.score, delta: prev ? cur.score - prev.score : null };
    if (prev) {
      const d = diffAudits(prev, cur);
      for (const code of d.newIssueTypes) cands.push({ key: `seoerr:${code}:${cur.at.slice(0, 10)}`, family: "biz", severity: "warning", oneShot: true, title: `New crawl issue: ${code.replace(/_/g, " ")}`, body: `New in the latest site audit (${cur.counts[code]} page${cur.counts[code] === 1 ? "" : "s"}).` });
      if (cur.score - prev.score <= -5) cands.push({ key: `seoscore:${cur.at.slice(0, 10)}`, family: "biz", severity: "warning", oneShot: true, title: `SEO audit score dropped ${prev.score} → ${cur.score}`, body: "" });
    }
  }
  for (const q of opp?.falling ?? []) {
    if (q.deltaPosition !== null && q.deltaPosition >= 3 && q.impressions >= 50) {
      cands.push({ key: `rank:${q.query}:${today.slice(0, 7)}`, family: "biz", severity: "warning", oneShot: true, title: `Ranking drop: “${q.query}” ${q.prevPosition?.toFixed(1)} → ${q.position.toFixed(1)}`, body: "" });
    }
  }
  const prevState = await kvGet<AlertState>(stateKey, {});
  const r = applyDedupe(cands, prevState, "biz");

  const mrrPrev = (() => { const s = snaps.snapshots.filter((x) => x.day < today); return s.length ? s[s.length - 1].data.mrr : null; })();
  const newCanc = m.recentActivity.filter((a) => a.type === "status_change" && /cancel/i.test(a.label) && new Date(a.date).getTime() > since);
  const input: DigestInput = {
    date: today,
    siteName: process.env.SITE_NAME || "NorthBooks",
    mrr: m.mrrActual ?? m.mrr,
    mrrPrev,
    mrrSource: m.mrrActual != null ? "helcim" : "estimate",
    paid: m.paidSubscribers,
    users: m.totalUsers,
    signups7: m.signups.last7Days,
    cancellations30: m.cancellations.last30Days,
    atRisk: m.atRiskCount,
    newSignups: m.subscriberList.filter((s) => new Date(s.joinedAt).getTime() > since).map((s) => ({ name: name(s), source: s.leadSource })),
    newCancellations: newCanc.map((a) => ({ name: pii() ? a.maskedUser : "a subscriber", plan: null })),
    needsAttention: r.send.map((c) => ({ severity: c.severity, text: c.title + (c.body && c.body !== c.title ? ` — ${c.body}` : "") })),
    ongoingAttention: r.ongoing.length,
    followUpsDue: crm.contacts
      .filter((c) => c.followUpOn && c.followUpOn <= today)
      .map((c) => { const s = m.subscriberList.find((x) => x.id === c.userId); return { name: s ? name(s) : c.userId.slice(0, 6), due: c.followUpOn!, note: null }; }),
    uptime: mon.targets.map((t) => ({ url: t.url, pct24: t.uptime24h })),
    certs: mon.certs.map((c) => ({ host: c.host, daysLeft: c.daysLeft })),
    domains: mon.domains.map((d) => ({ domain: d.domain, daysLeft: d.daysLeft })),
    seo,
    newMentions: mentions ? mentions.items.filter((i) => i.isNew).length : null,
  };
  const digest = buildDigest(input);
  if (opts.send) {
    await notify({ kind: "digest", severity: digest.attention ? "warning" : "info", title: digest.subject, body: digest.text, html: digest.html, subject: digest.subject });
    await kvSet(stateKey, r.state);
    await kvSet("digest_last_at", new Date().toISOString());
  }
  return { ...digest, sent: opts.send };
}
