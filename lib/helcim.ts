import type {
  HelcimMonth,
  HelcimSubscription,
  HelcimSummary,
  HelcimTransaction,
} from "./adminTypes";

// Helcim v2 REST API (https://devdocs.helcim.com). Auth is an `api-token`
// header. The endpoints used (all read-only):
//   GET /v2/subscriptions      (limit ≤ 100, offset)
//   GET /v2/payment-plans
//   GET /v2/customers
//   GET /v2/card-transactions  (dateFrom, dateTo, limit ≤ 1000, page)
// Response shapes are parsed defensively — field names are read with
// fallbacks and anything unexpected is surfaced as a warning rather than
// crashing the dashboard.

const BASE = "https://api.helcim.com/v2";

export const EMPTY_HELCIM: HelcimSummary = {
  configured: false,
  fetchedAt: null,
  error: null,
  warnings: [],
  subscriptions: [],
  byStatus: {},
  activeCount: 0,
  mrr: 0,
  failedPaymentCount: 0,
  pausedCount: 0,
  overdueCount: 0,
  upcoming7d: { count: 0, amount: 0 },
  plans: [],
  months: [],
  last30: { gross: 0, refunds: 0, net: 0, approved: 0, declined: 0 },
  recentDeclines: [],
  unmatchedActive: 0,
};

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
const nbr = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const bool = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";

/** Pull the array out of whatever envelope Helcim returned. */
export function rowsOf(json: unknown): Obj[] {
  if (Array.isArray(json)) return json as Obj[];
  if (json && typeof json === "object") {
    for (const v of Object.values(json as Obj)) {
      if (Array.isArray(v) && v.every((x) => x && typeof x === "object")) return v as Obj[];
    }
  }
  return [];
}

// ---------- pure normalisers (unit-testable) ----------

const PERIOD_FACTOR: Record<string, number> = {
  daily: 365 / 12,
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  semiannually: 1 / 6,
  semiannual: 1 / 6,
  yearly: 1 / 12,
  annually: 1 / 12,
  annual: 1 / 12,
};

export function monthlyFactor(period: string | null, increments: number): number {
  const base = PERIOD_FACTOR[(period ?? "monthly").toLowerCase().replace(/[\s_-]/g, "")] ?? 1;
  return base / Math.max(1, increments || 1);
}

export function normalizePlans(rows: Obj[]) {
  return rows.map((p) => ({
    id: (p.id ?? p.paymentPlanId ?? "") as number | string,
    name: str(p.name) ?? str(p.planName) ?? `Plan ${p.id ?? ""}`.trim(),
    amount: nbr(p.recurringAmount ?? p.amount),
    period: str(p.billingPeriod ?? p.period),
    increments: nbr(p.billingPeriodIncrements ?? p.periodIncrements) || 1,
  }));
}

export function normalizeSubscriptions(
  rows: Obj[],
  plans: ReturnType<typeof normalizePlans>,
  customers: Map<string, { email: string | null; name: string | null }>
): HelcimSubscription[] {
  const planById = new Map(plans.map((p) => [String(p.id), p]));
  return rows.map((s) => {
    const planId = (s.paymentPlanId ?? s.planId ?? null) as number | string | null;
    const plan = planId !== null ? planById.get(String(planId)) : undefined;
    const recurring = nbr(s.recurringAmount ?? s.amount ?? plan?.amount);
    const code = str(s.customerCode);
    const cust = code ? customers.get(code) : undefined;
    return {
      id: (s.id ?? s.subscriptionId ?? "") as number | string,
      customerCode: code,
      customerEmail: cust?.email ?? str(s.email),
      customerName: cust?.name ?? str(s.contactName) ?? str(s.customerName),
      paymentPlanId: planId,
      planName: plan?.name ?? str(s.planName) ?? str(s.paymentPlanName),
      status: (str(s.status) ?? "unknown").toLowerCase(),
      recurringAmount: recurring,
      monthlyAmount: Math.round(recurring * monthlyFactor(plan?.period ?? str(s.billingPeriod), plan?.increments ?? 1) * 100) / 100,
      billingPeriod: plan?.period ?? str(s.billingPeriod),
      dateActivated: str(s.dateActivated),
      dateBilling: str(s.dateBilling ?? s.nextBillingDate),
      timesBilled: nbr(s.timesBilled),
      hasFailedPayments: bool(s.hasFailedPayments),
      matchedUserId: null,
      matchedBy: null,
    };
  });
}

export function normalizeTransactions(rows: Obj[]): HelcimTransaction[] {
  return rows.map((t) => ({
    id: String(t.transactionId ?? t.id ?? ""),
    date: str(t.dateCreated ?? t.date) ?? "",
    amount: nbr(t.amount),
    type: (str(t.type) ?? "").toLowerCase(),
    status: (str(t.status) ?? "").toLowerCase(),
    customerCode: str(t.customerCode),
    currency: str(t.currency),
    cardType: str(t.cardType),
  }));
}

export function summarizeTransactions(txns: HelcimTransaction[], now = new Date()) {
  const months = new Map<string, HelcimMonth>();
  const cutoff30 = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const last30 = { gross: 0, refunds: 0, net: 0, approved: 0, declined: 0 };
  const declines: HelcimTransaction[] = [];

  for (const t of txns) {
    const month = t.date.slice(0, 7);
    if (!month) continue;
    const m = months.get(month) ?? { month, gross: 0, refunds: 0, net: 0, approved: 0, declined: 0 };
    const isCharge = t.type === "purchase" || t.type === "capture";
    const isRefund = t.type === "refund";
    const approved = t.status === "approved";
    const declined = t.status === "declined";
    const recent = t.date.slice(0, 10) >= cutoff30;

    if (isCharge && approved) {
      m.gross += t.amount;
      m.approved += 1;
      if (recent) { last30.gross += t.amount; last30.approved += 1; }
    } else if (isRefund && approved) {
      m.refunds += t.amount;
      if (recent) last30.refunds += t.amount;
    } else if (declined && (isCharge || t.type === "")) {
      m.declined += 1;
      declines.push(t);
      if (recent) last30.declined += 1;
    }
    m.net = m.gross - m.refunds;
    months.set(month, m);
  }
  last30.net = last30.gross - last30.refunds;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    months: Array.from(months.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({ ...m, gross: round(m.gross), refunds: round(m.refunds), net: round(m.net) })),
    last30: { ...last30, gross: round(last30.gross), refunds: round(last30.refunds), net: round(last30.net) },
    recentDeclines: declines.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25),
  };
}

export function summarizeSubscriptions(subs: HelcimSubscription[], now = new Date()) {
  const byStatus: Record<string, number> = {};
  let mrr = 0, failed = 0, paused = 0, overdue = 0, upCount = 0, upAmount = 0;
  const in7 = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  for (const s of subs) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    if (s.status === "paused") paused += 1;
    if (s.status === "active" || s.status === "term_ending") {
      mrr += s.monthlyAmount;
      if (s.hasFailedPayments) failed += 1;
      const due = s.dateBilling?.slice(0, 10);
      if (due && due < today) overdue += 1;
      if (due && due >= today && due <= in7) { upCount += 1; upAmount += s.recurringAmount; }
    }
  }
  return {
    byStatus,
    mrr: Math.round(mrr * 100) / 100,
    failedPaymentCount: failed,
    pausedCount: paused,
    overdueCount: overdue,
    upcoming7d: { count: upCount, amount: Math.round(upAmount * 100) / 100 },
    activeCount: (byStatus.active ?? 0) + (byStatus.term_ending ?? 0),
  };
}

// ---------- network ----------

async function hget(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${BASE}${path}${qs.size ? `?${qs}` : ""}`, {
    headers: { "api-token": process.env.HELCIM_API_TOKEN!, accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 204) return [];
  const text = await res.text();
  if (!res.ok) throw new Error(`Helcim ${path} returned ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Helcim ${path} returned non-JSON`);
  }
}

async function paged(path: string, pageSize: number, extra: Record<string, string | number> = {}) {
  const out: Obj[] = [];
  for (let page = 0; page < 20; page++) {
    const rows = rowsOf(await hget(path, { ...extra, limit: pageSize, offset: page * pageSize }));
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

const g = globalThis as unknown as { __helcim?: { at: number; data: HelcimSummary } };
const TTL = 10 * 60 * 1000;

export function helcimConfigured() {
  return Boolean(process.env.HELCIM_API_TOKEN);
}

export async function getHelcimSummary(force = false): Promise<HelcimSummary> {
  if (!helcimConfigured()) return EMPTY_HELCIM;
  if (!force && g.__helcim && Date.now() - g.__helcim.at < TTL) return g.__helcim.data;

  const warnings: string[] = [];
  try {
    const subsRaw = await paged("/subscriptions", 100);

    let plans: ReturnType<typeof normalizePlans> = [];
    try {
      plans = normalizePlans(rowsOf(await hget("/payment-plans", { limit: 100 })));
    } catch (e) {
      warnings.push(`payment plans: ${e instanceof Error ? e.message : "failed"}`);
    }

    const customers = new Map<string, { email: string | null; name: string | null }>();
    try {
      for (const c of await paged("/customers", 100)) {
        const code = str(c.customerCode);
        if (!code) continue;
        const billing = (c.billingAddress ?? {}) as Obj;
        customers.set(code, {
          email: (str(c.email) ?? str(billing.email) ?? str(c.contactEmail))?.toLowerCase() ?? null,
          name: str(c.contactName) ?? str(c.businessName),
        });
      }
    } catch (e) {
      warnings.push(`customers: ${e instanceof Error ? e.message : "failed"}`);
    }

    let tx: ReturnType<typeof summarizeTransactions> = {
      months: [], last30: { gross: 0, refunds: 0, net: 0, approved: 0, declined: 0 }, recentDeclines: [],
    };
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 120 * 86_400_000);
      const txRaw: Obj[] = [];
      for (let page = 1; page <= 10; page++) {
        const rows = rowsOf(
          await hget("/card-transactions", {
            dateFrom: from.toISOString().slice(0, 10),
            dateTo: to.toISOString().slice(0, 10),
            limit: 1000,
            page,
          })
        );
        txRaw.push(...rows);
        if (rows.length < 1000) break;
      }
      tx = summarizeTransactions(normalizeTransactions(txRaw));
    } catch (e) {
      warnings.push(`transactions: ${e instanceof Error ? e.message : "failed"}`);
    }

    const subscriptions = normalizeSubscriptions(subsRaw, plans, customers);
    if (subsRaw.length > 0 && subscriptions.every((s) => !s.status || s.status === "unknown")) {
      warnings.push("Subscriptions came back in an unexpected shape (no status field) — check the Helcim response format.");
    }

    const data: HelcimSummary = {
      configured: true,
      fetchedAt: new Date().toISOString(),
      error: null,
      warnings,
      subscriptions,
      ...summarizeSubscriptions(subscriptions),
      plans: plans.map(({ id, name, amount, period }) => ({ id, name, amount, period })),
      ...tx,
      unmatchedActive: 0, // filled in once matched against profiles
    };
    g.__helcim = { at: Date.now(), data };
    return data;
  } catch (err) {
    return { ...EMPTY_HELCIM, configured: true, error: err instanceof Error ? err.message : "Helcim request failed" };
  }
}
