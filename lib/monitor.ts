import "server-only";
import tls from "node:tls";
import { kvGet, kvSet, sb, tryTable } from "./adminStore";
import { readCache, writeCache } from "./seo/store";
import { seoSiteUrl } from "./seo/config";
import type { CertInfo, DomainInfo, MonitorCheck, MonitorStatus, TargetStatus } from "./adminTypes";
import { daysUntil, parseManualExpiry, parseRdap, registrableDomain, SHARED_HOST, targetStatus } from "./ops";
import { listNotifications, channelsConfigured } from "./notify";

const FILE = "monitor-checks.json";
const KEEP_DAYS = 35;
const FILE_CAP = 3000;

export function monitorUrls(): string[] {
  const raw = process.env.MONITOR_URLS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const urls = raw.length ? raw : [seoSiteUrl()].filter((u): u is string => !!u);
  return [...new Set<string>(urls.map((u) => (u.startsWith("http") ? u : `https://${u}`)))];
}

export const thresholds = () => ({
  sslDays: Number(process.env.ALERT_SSL_DAYS) || 21,
  domainDays: Number(process.env.ALERT_DOMAIN_DAYS) || 45,
});

// ---------- HTTP check ----------

export async function checkUrl(url: string): Promise<MonitorCheck> {
  const at = new Date().toISOString();
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "NorthBooksMonitor/1.0" }, cache: "no-store" });
    const latencyMs = Date.now() - t0;
    await res.body?.cancel().catch(() => {});
    const ok = res.status >= 200 && res.status < 400;
    return { at, target: url, ok, status: res.status, latencyMs, detail: ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "Timed out after 15s" : e.message) : "request failed";
    return { at, target: url, ok: false, status: null, latencyMs: Date.now() - t0, detail: msg };
  }
}

// ---------- TLS ----------

export function tlsInfo(host: string): Promise<CertInfo> {
  const checkedAt = new Date().toISOString();
  return new Promise((resolve) => {
    const fail = (error: string) => resolve({ host, checkedAt, validTo: null, daysLeft: null, issuer: null, authorized: false, error });
    const sock = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 10_000 }, () => {
      const c = sock.getPeerCertificate();
      const authorized = sock.authorized;
      const err = sock.authorizationError ? String(sock.authorizationError) : null;
      sock.end();
      if (!c || !c.valid_to) return fail("No certificate returned");
      const validTo = new Date(c.valid_to).toISOString();
      const issuer = (c.issuer as { O?: string; CN?: string } | undefined);
      resolve({ host, checkedAt, validTo, daysLeft: daysUntil(validTo), issuer: issuer?.O ?? issuer?.CN ?? null, authorized, error: authorized ? null : err });
    });
    sock.on("timeout", () => { sock.destroy(); fail("TLS connection timed out"); });
    sock.on("error", (e) => fail(e.message));
  });
}

// ---------- domain expiry (RDAP, free) ----------

let bootstrap: { at: number; map: Record<string, string> } | null = null;

async function rdapBase(tld: string): Promise<string[]> {
  if (!bootstrap || Date.now() - bootstrap.at > 7 * 86_400_000) {
    try {
      const j = (await (await fetch("https://data.iana.org/rdap/dns.json", { signal: AbortSignal.timeout(10_000) })).json()) as { services: [string[], string[]][] };
      const map: Record<string, string> = {};
      for (const [tlds, urls] of j.services) for (const t of tlds) map[t] = urls[0];
      bootstrap = { at: Date.now(), map };
    } catch { bootstrap = { at: Date.now(), map: {} }; }
  }
  const base = bootstrap.map[tld];
  return [base ? `${base.replace(/\/$/, "")}/domain/` : null, "https://rdap.org/domain/"].filter((x): x is string => !!x);
}

export async function lookupDomain(domain: string, manual: Record<string, string>): Promise<DomainInfo> {
  const checkedAt = new Date().toISOString();
  const base: DomainInfo = { domain, checkedAt, expires: null, daysLeft: null, registrar: null, source: null, error: null };
  const m = manual[domain];
  let rdapErr: string | null = null;
  for (const prefix of await rdapBase(domain.split(".").pop()!)) {
    try {
      const res = await fetch(prefix + domain, { headers: { accept: "application/rdap+json" }, signal: AbortSignal.timeout(12_000), redirect: "follow" });
      if (!res.ok) { rdapErr = `RDAP ${res.status}`; continue; }
      const p = parseRdap(await res.json());
      if (p.expires) return { ...base, expires: p.expires, daysLeft: daysUntil(p.expires), registrar: p.registrar, source: "rdap" };
      rdapErr = "Registry doesn't publish an expiry date";
      base.registrar = p.registrar;
      break;
    } catch (e) { rdapErr = e instanceof Error ? e.message : "RDAP failed"; }
  }
  if (m) {
    const iso = new Date(`${m}T00:00:00Z`).toISOString();
    return { ...base, expires: iso, daysLeft: daysUntil(iso), source: "manual" };
  }
  return { ...base, error: `${rdapErr ?? "Lookup failed"} — set MONITOR_DOMAIN_EXPIRY=${domain}=YYYY-MM-DD to track it manually` };
}

// ---------- storage ----------

async function loadChecks(): Promise<{ checks: MonitorCheck[]; durable: boolean }> {
  const r = await tryTable("admin_monitor_checks", () =>
    sb().from("admin_monitor_checks").select("checked_at,target,ok,status,latency_ms,detail")
      .gte("checked_at", new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString()).order("checked_at", { ascending: true }).limit(20000)
  );
  if (r.ok) {
    const rows = (r.data ?? []) as { checked_at: string; target: string; ok: boolean; status: number | null; latency_ms: number | null; detail: string | null }[];
    return { checks: rows.map((x) => ({ at: x.checked_at, target: x.target, ok: x.ok, status: x.status, latencyMs: x.latency_ms, detail: x.detail })), durable: true };
  }
  return { checks: readCache<MonitorCheck[]>(FILE, []), durable: false };
}

async function saveChecks(fresh: MonitorCheck[]): Promise<void> {
  const r = await tryTable("admin_monitor_checks", () =>
    sb().from("admin_monitor_checks").insert(fresh.map((c) => ({ checked_at: c.at, target: c.target, ok: c.ok, status: c.status, latency_ms: c.latencyMs, detail: c.detail }))).select().then((x) => x as never)
  );
  if (r.ok) {
    // prune old rows now and then (cheap)
    if (Math.random() < 0.05) await tryTable("admin_monitor_checks", () => sb().from("admin_monitor_checks").delete().lt("checked_at", new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString()).select().then((x) => x as never));
    return;
  }
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const all = [...readCache<MonitorCheck[]>(FILE, []), ...fresh].filter((c) => new Date(c.at).getTime() > cutoff);
  writeCache(FILE, all.slice(-FILE_CAP));
}

// ---------- run ----------

const g = globalThis as unknown as { __monRun?: { at: number; p: Promise<unknown> } };

/** Run every HTTP check; refresh certs (every 6h) and domains (every 12h). */
export async function runMonitor(opts: { minIntervalSec?: number } = {}): Promise<{ ran: boolean; checks: MonitorCheck[] }> {
  const last = await kvGet<string | null>("monitor_last_run", null);
  if (opts.minIntervalSec && last && Date.now() - new Date(last).getTime() < opts.minIntervalSec * 1000) return { ran: false, checks: [] };
  const urls = monitorUrls();
  const checks = await Promise.all(urls.map(checkUrl));
  if (checks.length) await saveChecks(checks);
  await kvSet("monitor_last_run", new Date().toISOString());
  await refreshExpiry(urls);
  return { ran: true, checks };
}

export async function refreshExpiry(urls = monitorUrls(), force = false): Promise<{ certs: CertInfo[]; domains: DomainInfo[] }> {
  const hosts = [...new Set(urls.map((u) => { try { return new URL(u).hostname; } catch { return ""; } }).filter(Boolean))];
  const extra = process.env.MONITOR_DOMAINS?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) ?? [];
  const domains = [...new Set([...hosts.map(registrableDomain), ...extra].filter((d): d is string => !!d && !SHARED_HOST.test(d)))];
  const cached = await kvGet<{ certs: CertInfo[]; domains: DomainInfo[] }>("monitor_expiry", { certs: [], domains: [] });
  const age = (iso?: string) => (iso ? Date.now() - new Date(iso).getTime() : Infinity);

  const certs = await Promise.all(hosts.map(async (h) => {
    const c = cached.certs.find((x) => x.host === h);
    return c && !force && age(c.checkedAt) < 6 * 3_600_000 ? { ...c, daysLeft: daysUntil(c.validTo) } : tlsInfo(h);
  }));
  const manual = parseManualExpiry(process.env.MONITOR_DOMAIN_EXPIRY);
  const doms = await Promise.all(domains.map(async (d) => {
    const c = cached.domains.find((x) => x.domain === d);
    return c && !force && age(c.checkedAt) < 12 * 3_600_000 ? { ...c, daysLeft: daysUntil(c.expires) } : lookupDomain(d, manual);
  }));
  await kvSet("monitor_expiry", { certs, domains: doms });
  return { certs, domains: doms };
}

export async function getMonitorStatus(): Promise<MonitorStatus> {
  const urls = monitorUrls();
  const { checks, durable } = await loadChecks();
  const exp = await kvGet<{ certs: CertInfo[]; domains: DomainInfo[] }>("monitor_expiry", { certs: [], domains: [] });
  const targets: TargetStatus[] = urls.map((u) => targetStatus(u, checks));
  return {
    configured: urls.length > 0,
    targets,
    certs: exp.certs.map((c) => ({ ...c, daysLeft: daysUntil(c.validTo) })),
    domains: exp.domains.map((d) => ({ ...d, daysLeft: daysUntil(d.expires) })),
    notifications: await listNotifications(),
    channels: channelsConfigured(),
    thresholds: thresholds(),
    durable,
    lastRunAt: await kvGet<string | null>("monitor_last_run", null),
  };
}
