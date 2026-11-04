// Pure, client-safe operations logic: uptime maths, RDAP parsing,
// alert candidates, de-duplication and the daily digest text.
import type { CertInfo, DomainInfo, MonitorCheck, TargetStatus } from "./adminTypes";

const DAY = 86_400_000;

// ---------- uptime ----------

export function uptimePct(checks: MonitorCheck[], sinceMs: number, now = Date.now()): number | null {
  const win = checks.filter((c) => now - new Date(c.at).getTime() <= sinceMs);
  if (win.length === 0) return null;
  return win.filter((c) => c.ok).length / win.length;
}

export function targetStatus(url: string, all: MonitorCheck[], now = Date.now()): TargetStatus {
  const mine = all.filter((c) => c.target === url).sort((a, b) => a.at.localeCompare(b.at));
  const day = mine.filter((c) => now - new Date(c.at).getTime() <= DAY);
  const lat = day.map((c) => c.latencyMs).filter((n): n is number => typeof n === "number");
  return {
    url,
    last: mine[mine.length - 1] ?? null,
    uptime24h: uptimePct(mine, DAY, now),
    uptime7d: uptimePct(mine, 7 * DAY, now),
    uptime30d: uptimePct(mine, 30 * DAY, now),
    avgLatency24h: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
    checks24h: day.length,
    recent: mine.slice(-120).map((c) => ({ at: c.at, ok: c.ok, latencyMs: c.latencyMs })),
  };
}

export const daysUntil = (iso: string | null, now = Date.now()): number | null =>
  iso && !Number.isNaN(new Date(iso).getTime()) ? Math.floor((new Date(iso).getTime() - now) / DAY) : null;

// ---------- domains ----------

/** The registrable domain (naive: handles .co.uk-style second levels). */
export function registrableDomain(host: string): string | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h === "localhost") return null;
  const p = h.split(".");
  if (p.length <= 2) return h;
  const tld = p[p.length - 1];
  const sld = p[p.length - 2];
  if (tld.length === 2 && ["co", "com", "org", "net", "gov", "ac", "edu"].includes(sld)) return p.slice(-3).join(".");
  return p.slice(-2).join(".");
}

// Hosts that sit on someone else's domain — there's nothing for you to renew.
export const SHARED_HOST = /(^|\.)(vercel\.app|netlify\.app|github\.io|herokuapp\.com|pages\.dev|onrender\.com|fly\.dev)$/i;

/** Parse an RDAP "domain" response into expiry + registrar. */
export function parseRdap(json: unknown): { expires: string | null; registrar: string | null } {
  const j = json as { events?: { eventAction?: string; eventDate?: string }[]; entities?: { roles?: string[]; vcardArray?: unknown[]; handle?: string }[] };
  const ev = j?.events?.find((e) => /expiration/i.test(e.eventAction ?? ""));
  let registrar: string | null = null;
  for (const ent of j?.entities ?? []) {
    if (!ent.roles?.includes("registrar")) continue;
    const props = (ent.vcardArray?.[1] as unknown[][] | undefined) ?? [];
    const fn = props.find((p) => p[0] === "fn");
    registrar = (fn?.[3] as string) ?? ent.handle ?? null;
    if (registrar) break;
  }
  const d = ev?.eventDate ? new Date(ev.eventDate) : null;
  return { expires: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null, registrar };
}

/** MONITOR_DOMAIN_EXPIRY="example.ca=2027-03-04,other.com=2026-12-01" */
export function parseManualExpiry(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw ?? "").split(",")) {
    const [d, date] = part.split("=").map((s) => s.trim());
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) out[d.toLowerCase()] = date;
  }
  return out;
}

// ---------- alerts ----------

export type Severity = "critical" | "warning" | "info";

export type AlertCandidate = {
  key: string; // identity for de-duplication, e.g. "down:https://x.ca"
  family: string; // "infra" | "biz" — which pass owns it (so a pass doesn't resolve the other's alerts)
  severity: Severity;
  title: string;
  body: string;
  bucket?: string; // changing bucket = escalation (e.g. SSL 21 → 7 days)
  remindEveryHours?: number; // resend while still active
  oneShot?: boolean; // an event (new signup) rather than a state; never "resolves"
  notifyResolved?: boolean;
};

export type AlertState = Record<string, { since: string; lastSent: string; bucket?: string; family: string; oneShot?: boolean; title: string; notifyResolved?: boolean }>;

export type DedupeResult = {
  send: AlertCandidate[]; // new, escalated or due a reminder
  ongoing: AlertCandidate[]; // still active, already notified
  resolved: { key: string; title: string; since: string }[];
  state: AlertState;
};

export function applyDedupe(candidates: AlertCandidate[], prev: AlertState, family: string, now = Date.now()): DedupeResult {
  const state: AlertState = { ...prev };
  const send: AlertCandidate[] = [];
  const ongoing: AlertCandidate[] = [];
  const nowIso = new Date(now).toISOString();
  const seen = new Set<string>();

  for (const c of candidates) {
    seen.add(c.key);
    const st = state[c.key];
    const due = st && c.remindEveryHours ? now - new Date(st.lastSent).getTime() >= c.remindEveryHours * 3_600_000 : false;
    if (!st || (c.bucket !== undefined && st.bucket !== c.bucket) || due) {
      send.push(c);
      state[c.key] = { since: st?.since ?? nowIso, lastSent: nowIso, bucket: c.bucket, family: c.family, oneShot: c.oneShot, title: c.title, notifyResolved: c.notifyResolved };
    } else ongoing.push(c);
  }

  const resolved: DedupeResult["resolved"] = [];
  for (const [key, st] of Object.entries(prev)) {
    if (st.family !== family || seen.has(key)) continue;
    if (st.oneShot) {
      if (now - new Date(st.since).getTime() > 30 * DAY) delete state[key]; // just forget old events
      continue;
    }
    delete state[key];
    if (st.notifyResolved) resolved.push({ key, title: st.title, since: st.since });
  }
  return { send, ongoing, resolved, state };
}

export type InfraThresholds = { sslDays: number; domainDays: number };

const SSL_BUCKETS = [0, 1, 3, 7, 14, 21, 30];
const DOMAIN_BUCKETS = [0, 1, 7, 14, 30, 45, 60];
const bucketFor = (days: number, buckets: number[]) => String(buckets.find((b) => days <= b) ?? "ok");

/** Alerts derivable from monitor data alone (cheap — runs on every check). */
export function infraCandidates(
  targets: TargetStatus[],
  certs: CertInfo[],
  domains: DomainInfo[],
  t: InfraThresholds
): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const tg of targets) {
    const last2 = tg.recent.slice(-2);
    // Two failures in a row, so one blip doesn't wake you up.
    if (last2.length === 2 && last2.every((c) => !c.ok)) {
      out.push({
        key: `down:${tg.url}`, family: "infra", severity: "critical", notifyResolved: true, remindEveryHours: 6,
        title: `🔴 ${tg.url} is DOWN`,
        body: `${tg.last?.detail ?? "No response"}${tg.last?.status ? ` (HTTP ${tg.last.status})` : ""}. Last good check: ${[...tg.recent].reverse().find((c) => c.ok)?.at.slice(0, 16).replace("T", " ") ?? "unknown"} UTC.`,
      });
    }
    const last3 = tg.recent.slice(-3);
    if (last3.length === 3 && last3.every((c) => c.ok && (c.latencyMs ?? 0) > 4000)) {
      out.push({
        key: `slow:${tg.url}`, family: "infra", severity: "warning", notifyResolved: true, remindEveryHours: 24,
        title: `🐌 ${tg.url} is responding slowly`,
        body: `Last 3 checks took ${last3.map((c) => `${((c.latencyMs ?? 0) / 1000).toFixed(1)}s`).join(", ")}.`,
      });
    }
  }
  for (const c of certs) {
    if (c.error && c.daysLeft === null) continue; // can't tell — shown in the UI, not alerted
    if (!c.authorized && c.daysLeft !== null) {
      out.push({ key: `sslbad:${c.host}`, family: "infra", severity: "critical", notifyResolved: true, remindEveryHours: 12, title: `🔴 SSL certificate for ${c.host} is not trusted`, body: c.error ?? "The certificate chain or hostname is invalid." });
    }
    if (c.daysLeft !== null && c.daysLeft <= t.sslDays) {
      const b = bucketFor(c.daysLeft, SSL_BUCKETS);
      out.push({
        key: `ssl:${c.host}`, family: "infra", severity: c.daysLeft <= 7 ? "critical" : "warning", bucket: b, notifyResolved: true,
        title: `${c.daysLeft <= 7 ? "🔴" : "🟠"} SSL certificate for ${c.host} expires in ${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"}`,
        body: `Valid until ${c.validTo?.slice(0, 10)}${c.issuer ? ` (issuer: ${c.issuer})` : ""}. Auto-renewal may have failed — check your host.`,
      });
    }
  }
  for (const d of domains) {
    if (d.daysLeft !== null && d.daysLeft <= t.domainDays) {
      const b = bucketFor(d.daysLeft, DOMAIN_BUCKETS);
      out.push({
        key: `domain:${d.domain}`, family: "infra", severity: d.daysLeft <= 14 ? "critical" : "warning", bucket: b, notifyResolved: true,
        title: `${d.daysLeft <= 14 ? "🔴" : "🟠"} Domain ${d.domain} expires in ${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"}`,
        body: `Expires ${d.expires?.slice(0, 10)}${d.registrar ? ` · registrar: ${d.registrar}` : ""}. Renew it (and turn on auto-renew) before it lapses.`,
      });
    }
  }
  return out;
}

// ---------- digest ----------

export type DigestInput = {
  date: string; // YYYY-MM-DD
  siteName: string;
  mrr: number | null;
  mrrPrev: number | null; // previous snapshot day
  mrrSource: "helcim" | "estimate";
  paid: number;
  users: number;
  signups7: number;
  cancellations30: number;
  atRisk: number;
  newSignups: { name: string; source: string }[];
  newCancellations: { name: string; plan: string | null }[];
  needsAttention: { severity: Severity; text: string }[]; // new or weekly-reminder items
  ongoingAttention: number; // items already reported earlier and still open
  followUpsDue: { name: string; due: string; note: string | null }[];
  uptime: { url: string; pct24: number | null }[];
  certs: { host: string; daysLeft: number | null }[];
  domains: { domain: string; daysLeft: number | null }[];
  seo: { score: number; delta: number | null } | null;
  newMentions: number | null;
};

const money = (n: number) => `$${n.toLocaleString("en-CA", { maximumFractionDigits: 2 })}`;
const pctText = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(v === 1 ? 0 : 2)}%`);

export function buildDigest(d: DigestInput): { subject: string; text: string; html: string; attention: number } {
  const lines: string[] = [];
  const delta = d.mrr !== null && d.mrrPrev !== null ? d.mrr - d.mrrPrev : null;
  const crit = d.needsAttention.filter((n) => n.severity === "critical").length;
  const attention = d.needsAttention.length;
  const subject = `${d.siteName} daily digest — ${d.date}${attention ? ` · ${attention} need${attention === 1 ? "s" : ""} attention` : " · all clear"}`;

  lines.push(`*${d.siteName} — ${d.date}*`);
  lines.push(
    `MRR ${d.mrr === null ? "n/a" : money(d.mrr)}${d.mrrSource === "estimate" ? " (estimate)" : ""}${delta !== null && delta !== 0 ? ` (${delta > 0 ? "+" : "−"}${money(Math.abs(delta))} vs last snapshot)` : ""}` +
      ` · ${d.paid} paid · ${d.users} users · ${d.signups7} signups (7d) · ${d.cancellations30} cancellations (30d) · ${d.atRisk} at risk`
  );

  if (d.needsAttention.length) {
    lines.push("", `*Needs attention${crit ? ` (${crit} critical)` : ""}*`);
    for (const n of d.needsAttention) lines.push(`${n.severity === "critical" ? "🔴" : n.severity === "warning" ? "🟠" : "🔵"} ${n.text}`);
  }
  if (d.ongoingAttention > 0) lines.push(`_${d.ongoingAttention} earlier issue${d.ongoingAttention === 1 ? "" : "s"} still open (already reported)._`);

  if (d.newSignups.length) {
    lines.push("", `*New signups (${d.newSignups.length})*`);
    for (const s of d.newSignups.slice(0, 10)) lines.push(`• ${s.name} — ${s.source}`);
    if (d.newSignups.length > 10) lines.push(`…and ${d.newSignups.length - 10} more`);
  }
  if (d.newCancellations.length) {
    lines.push("", `*New cancellations (${d.newCancellations.length})*`);
    for (const c of d.newCancellations.slice(0, 10)) lines.push(`• ${c.name}${c.plan ? ` (${c.plan})` : ""}`);
  }
  if (d.followUpsDue.length) {
    lines.push("", `*Follow-ups due (${d.followUpsDue.length})*`);
    for (const f of d.followUpsDue.slice(0, 10)) lines.push(`• ${f.name}${f.due < d.date ? ` (overdue since ${f.due})` : ""}${f.note ? ` — ${f.note.slice(0, 80)}` : ""}`);
  }

  const health: string[] = [];
  for (const u of d.uptime) health.push(`${u.url.replace(/^https?:\/\//, "")} up ${pctText(u.pct24)} (24h)`);
  for (const c of d.certs) if (c.daysLeft !== null) health.push(`SSL ${c.host}: ${c.daysLeft}d`);
  for (const x of d.domains) if (x.daysLeft !== null) health.push(`domain ${x.domain}: ${x.daysLeft}d`);
  if (d.seo) health.push(`SEO score ${d.seo.score}${d.seo.delta ? ` (${d.seo.delta > 0 ? "+" : ""}${d.seo.delta})` : ""}`);
  if (d.newMentions) health.push(`${d.newMentions} new brand mention${d.newMentions === 1 ? "" : "s"}`);
  if (health.length) lines.push("", `*Health*`, health.join(" · "));

  const text = lines.join("\n");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${lines
    .map((l) => (l === "" ? "<br>" : `<div>${esc(l).replace(/\*(.+?)\*/g, "<b>$1</b>").replace(/_(.+?)_/g, "<i>$1</i>")}</div>`))
    .join("")}</div>`;
  return { subject, text, html, attention };
}
