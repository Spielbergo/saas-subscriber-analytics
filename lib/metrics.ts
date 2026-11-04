import "server-only";
import { createSupabaseAdminClient } from "./supabase/admin";
import { coreActions } from "./activation";
import { getHelcimSummary, EMPTY_HELCIM, summarizeSubscriptions } from "./helcim";
import type { HelcimSubscription, HelcimSummary, ReconIssue } from "./adminTypes";
import {
  priceForPlan,
  isFreePlan,
  PLAN_PRICING,
  PRICING_FROM_ENV,
} from "./planPricing";

export type ActivityItem = {
  id: string;
  type: "signup" | "status_change";
  label: string; // human-readable, no personal data
  maskedUser: string;
  date: string; // ISO string
};

// A company row requires `name` and `user_id` at the database level, so
// its existence already implies the core onboarding flow (company name,
// BN, address, etc.) ran to completion — "has a company" and "completed
// business setup" are the same signal today.
//
// "building" = has created at least one product or project inside their
// company — the closest proxy available for a first meaningful action.
// "activated" and "returning" are intentionally not modeled yet: there's
// no transactions/invoices data in the schema to detect real product
// usage from. Add them here (and in the computation below) once that
// exists — everything downstream (the badge, the stat card) is written
// to extend rather than need rewriting.
export type ActivationStage = "not_started" | "set_up" | "building" | "activated";

export type UsageRow = {
  invoices: number;
  invoicesSent: number;
  invoicesPaid: number;
  invoicedTotal: number;
  firstInvoiceAt: string | null;
  lastInvoiceAt: string | null;
  clients: number;
  timeEntries: number;
  expenses: number;
  bankStatements: number;
  recurringInvoices: number;
  recurringExpenses: number;
  proposals: number;
};

export type SubHistoryItem = { plan: string | null; status: string | null; createdAt: string; updatedAt: string };

export type SubscriberRow = {
  id: string;
  email: string | null;
  fullName: string | null;
  companyNames: string[];
  plan: string | null;
  status: string | null;
  joinedAt: string;
  renewsAt: string | null;
  lastLoginAt: string | null;
  loginCount: number | null; // null means the optional sql/login_counts.sql migration hasn't been run
  // At-risk applies to PAID subscribers only (active/trialing on a plan
  // with a price). Everyone else who's gone quiet is "inactiveFree".
  atRisk: boolean;
  atRiskReason: string | null;
  inactiveFree: boolean;
  inactiveFreeReason: string | null;
  isPaid: boolean;
  renewalOverdueDays: number | null; // paid active/trialing whose period end is in the past
  // From your existing profiles columns: signup_utm_* are the UTMs on the
  // signup visit; first_touch_source / signup_touch_source are the
  // source labels your main app records for the first visit and the
  // signup visit.
  helcimStatus: string | null; // matched Helcim subscription, if any
  helcimNextBilling: string | null;
  helcimFailed: boolean;
  helcimMonthly: number | null;
  signupReferrer: string | null;
  signupSource: string | null; // signup_utm_source
  signupMedium: string | null; // signup_utm_medium
  signupCampaign: string | null; // signup_utm_campaign
  signupContent: string | null; // signup_utm_content
  signupTerm: string | null; // signup_utm_term
  firstTouchSource: string | null;
  signupTouchSource: string | null;
  // Always a human-readable label: "google / organic", "twitter", or
  // "Not captured" for anyone who signed up before attribution capture
  // existed in the main app.
  leadSource: string;
  signupMethod: string | null; // auth provider, e.g. "email", "google"
  emailConfirmed: boolean;
  activationStage: ActivationStage;
  usage: UsageRow | null; // null until sql/crm_data.sql has been run
  activated: boolean | null; // did a core task (invoice / expense / bank statement); null = unknown
  coreActions: string[];
  companyCreatedAt: string | null; // first company created
  subHistory: SubHistoryItem[];
  companyCount: number;
  province: string | null;
  hstRegistered: boolean | null; // null = couldn't tell from company settings
  productCount: number;
  projectCount: number;
};

export type Adoption = {
  users: number;
  withInvoice: number;
  withSentInvoice: number;
  withPaidInvoice: number;
  withClient: number;
  withTimeEntry: number;
  withExpense: number;
  withBankStatement: number;
  withRecurring: number;
  totalInvoices: number;
  totalInvoiced: number;
  medianDaysToFirstInvoice: number | null;
  activated: number; // did at least one core task
};

/** What really happened in the last 30 days, for checking GA4 conversion events against. */
export type EventTruth = {
  signups30: number;
  companies30: number;
  firstInvoices30: number | null; // null until sql/crm_data.sql is installed
  activations30: number | null;
  activationsSource: "helcim" | "supabase" | null;
};

export type Metrics = {
  totalUsers: number;
  totalCompanies: number;
  avgCompaniesPerUser: number;
  subscribers: {
    total: number;
    byStatus: Record<string, number>;
    byPlan: Record<string, number>;
  };
  mrr: number;
  signups: {
    last7Days: number;
    last30Days: number;
    series: { date: string; count: number }[]; // daily, last 30 days
  };
  cancellations: {
    last30Days: number;
    series: { date: string; count: number }[]; // daily, last 30 days (approx, based on updated_at)
  };
  upcomingRenewals: { maskedUser: string; plan: string; date: string }[];
  recentActivity: ActivityItem[];
  subscriberList: SubscriberRow[];
  loginCountsAvailable: boolean; // false until sql/login_counts.sql has been run
  trialConversion: {
    everTrialed: number;
    converted: number; // currently active, was trialing at some point
    stillTrialing: number;
    canceledFromTrial: number; // never made it past trial
    rate: number; // converted / everTrialed, 0 if no one has ever trialed
  };
  atRiskCount: number; // paid subscribers only
  inactiveFreeCount: number;
  paidSubscribers: number; // active/trialing on a priced plan
  freeUsers: number; // everyone else
  overdueRenewals: { maskedUser: string; plan: string; status: string; periodEnd: string; daysOverdue: number }[];
  pricingConfirmed: boolean; // false = using placeholder prices, set PLAN_PRICES
  setUpCount: number; // subscribers whose activationStage is "set_up"
  attributionAvailable: boolean; // false if the attribution columns can't be read from profiles
  // Extra aggregates — mostly here so the AI export has real breakdowns
  // to work with instead of making the model count rows itself.
  planPricing: Record<string, number>; // monthly price per plan, from lib/planPricing.ts
  mrrByPlan: Record<string, number>;
  leadSources: Record<string, number>; // signups per lead source label
  firstTouchSources: Record<string, number>;
  signupTouchSources: Record<string, number>;
  leadCampaigns: Record<string, number>; // utm_campaign
  leadContents: Record<string, number>; // utm_content (which post/variant)
  signupMethods: Record<string, number>;
  activationCounts: Record<ActivationStage, number>;
  usageAvailable: boolean; // false until sql/crm_data.sql has been run
  adoption: Adoption | null;
  neverLoggedInCount: number;
  unconfirmedEmailCount: number;
  provinces: Record<string, number>;
  productTotals: { products: number; projects: number; usersWithProducts: number; usersWithProjects: number };
  excludedTestAccounts: number; // profiles hidden via EXCLUDED_EMAILS
  excludedAccounts: { email: string | null; joinedAt: string; matchedBy: string | null }[]; // so you can see exactly who is hidden
  helcim: HelcimSummary; // payments (configured=false if HELCIM_API_TOKEN isn't set)
  mrrActual: number | null; // real recurring revenue from Helcim, null if unavailable
  reconciliation: ReconIssue[]; // Supabase vs Helcim disagreements
  mrrGoal: number | null; // MRR_GOAL env
  eventTruth: EventTruth;
  generatedAt: string;
};

// EXCLUDED_EMAILS: comma-separated list of test accounts to hide from
// every number on the dashboard. Each entry is an exact email or a
// pattern with * wildcards, case-insensitive, e.g.
//   me+test1@gmail.com, *@mytestdomain.com, test*@yopie.ca
function buildExcludeMatcher(raw: string | undefined) {
  const raw_ = (raw ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const patterns = raw_
    .map((p) => {
      // A bare "@domain.com" means everyone at that domain.
      const glob = p.startsWith("@") ? `*${p}` : p;
      const escaped = glob
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      return new RegExp(`^${escaped}$`);
    });
  return {
    patternCount: patterns.length,
    matchingPattern: (email: string | null | undefined): string | null =>
      email ? raw_.find((_, i) => patterns[i].test(email.toLowerCase())) ?? null : null,
    matches: (email: string | null | undefined) =>
      Boolean(email) && patterns.some((re) => re.test(email!.toLowerCase())),
  };
}

function maskId(id: string): string {
  return `user_${id.replace(/-/g, "").slice(0, 8)}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildDailySeries(
  dates: Date[],
  days: number
): { date: string; count: number }[] {
  const buckets = new Map<string, number>();
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets.set(isoDate(d), 0);
  }
  for (const d of dates) {
    const key = isoDate(d);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  return Array.from(buckets.entries()).map(([date, count]) => ({
    date,
    count,
  }));
}

type AdminAuthUser = {
  id: string;
  last_sign_in_at: string | null;
  provider: string | null;
  email_confirmed: boolean;
};

// Supabase Auth tracks last_sign_in_at automatically — no setup needed.
// Pages through the admin API since listUsers() caps out at perPage.
async function fetchAllAuthUsers(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<AdminAuthUser[]> {
  const perPage = 200;
  let page = 1;
  const all: AdminAuthUser[] = [];

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;
    all.push(
      ...data.users.map((u) => ({
        id: u.id,
        last_sign_in_at: u.last_sign_in_at ?? null,
        provider:
          (u.app_metadata?.provider as string | undefined) ??
          u.identities?.[0]?.provider ??
          null,
        email_confirmed: Boolean(u.email_confirmed_at),
      }))
    );
    if (data.users.length < perPage) break;
    page += 1;
  }

  return all;
}

type LoginCountRow = {
  user_id: string;
  login_count: number;
  last_login: string;
};

// Cached per server process. Once we know the RPC doesn't exist, skip
// straight to "unavailable" instead of retrying a call that's
// guaranteed to fail — that failed call still logs a real Postgres
// error in Supabase every time, even though the dashboard itself
// handles it gracefully. Resets on server restart, so running the SQL
// migration and restarting `npm run dev` picks it up immediately.
let loginCountsRpcAvailable: boolean | null = null;

// Best-effort: this RPC only exists once sql/login_counts.sql has been
// run in the SQL editor. If it hasn't, we just show "—" for the count
// rather than failing the whole dashboard.
async function fetchLoginCounts(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<{ available: boolean; byUser: Map<string, LoginCountRow> }> {
  if (loginCountsRpcAvailable === false) {
    return { available: false, byUser: new Map() };
  }

  const { data, error } = await supabase.rpc("admin_get_login_counts");

  if (error) {
    loginCountsRpcAvailable = false;
    return { available: false, byUser: new Map() };
  }

  loginCountsRpcAvailable = true;
  const byUser = new Map<string, LoginCountRow>();
  for (const row of (data as LoginCountRow[]) ?? []) {
    byUser.set(row.user_id, row);
  }
  return { available: true, byUser };
}

const EMPTY_USAGE: UsageRow = { invoices: 0, invoicesSent: 0, invoicesPaid: 0, invoicedTotal: 0, firstInvoiceAt: null, lastInvoiceAt: null, clients: 0, timeEntries: 0, expenses: 0, bankStatements: 0, recurringInvoices: 0, recurringExpenses: 0, proposals: 0 };

let usageRpcAvailable: boolean | null = null;

type UsageRpcRow = {
  user_id: string; invoices: number | string; invoices_sent: number | string; invoices_paid: number | string;
  invoiced_total: number | string; first_invoice_at: string | null; last_invoice_at: string | null;
  clients: number | string; time_entries: number | string; expenses: number | string; bank_statements: number | string;
  recurring_invoices: number | string; recurring_expenses: number | string; proposals: number | string;
};

// Best-effort: needs sql/crm_data.sql. Missing -> usage columns show "setup needed".
async function fetchUsage(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<{ available: boolean; byUser: Map<string, UsageRow> }> {
  if (usageRpcAvailable === false) return { available: false, byUser: new Map() };
  const { data, error } = await supabase.rpc("admin_get_usage");
  if (error) {
    usageRpcAvailable = false;
    return { available: false, byUser: new Map() };
  }
  usageRpcAvailable = true;
  const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0;
  const byUser = new Map<string, UsageRow>();
  for (const r of (data as UsageRpcRow[]) ?? []) {
    byUser.set(r.user_id, {
      invoices: n(r.invoices), invoicesSent: n(r.invoices_sent), invoicesPaid: n(r.invoices_paid),
      invoicedTotal: n(r.invoiced_total), firstInvoiceAt: r.first_invoice_at, lastInvoiceAt: r.last_invoice_at,
      clients: n(r.clients), timeEntries: n(r.time_entries), expenses: n(r.expenses), bankStatements: n(r.bank_statements),
      recurringInvoices: n(r.recurring_invoices), recurringExpenses: n(r.recurring_expenses), proposals: n(r.proposals),
    });
  }
  return { available: true, byUser };
}

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  first_touch_source: string | null;
  signup_touch_source: string | null;
  signup_utm_source: string | null;
  signup_utm_medium: string | null;
  signup_utm_campaign: string | null;
  signup_utm_content: string | null;
  signup_utm_term: string | null;
  signup_referrer: string | null;
};

// Cached per server process so a missing-column error isn't re-triggered
// (and re-logged in Supabase) on every load.
let attributionColumnsAvailable: boolean | null = null;

async function fetchProfiles(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<{ attributionAvailable: boolean; data: ProfileRow[] }> {
  const base = "id, email, full_name, created_at";
  const attribution =
    ", first_touch_source, signup_touch_source, signup_utm_source, signup_utm_medium, signup_utm_campaign, signup_utm_content, signup_utm_term, signup_referrer";

  if (attributionColumnsAvailable !== false) {
    const r = await supabase.from("profiles").select(base + attribution);
    if (!r.error) {
      attributionColumnsAvailable = true;
      return { attributionAvailable: true, data: (r.data ?? []) as ProfileRow[] };
    }
    attributionColumnsAvailable = false;
  }

  const basic = await supabase.from("profiles").select(base);
  if (basic.error) throw basic.error;
  return {
    attributionAvailable: false,
    data: (basic.data ?? []).map((p) => ({
      ...p,
      first_touch_source: null,
      signup_touch_source: null,
      signup_utm_source: null,
      signup_utm_medium: null,
      signup_utm_campaign: null,
      signup_utm_content: null,
      signup_utm_term: null,
      signup_referrer: null,
    })),
  };
}

type CompanyDetail = {
  user_id: string;
  province: string | null;
  hst_number: string | null;
  products: unknown;
  projects: unknown;
};

// Best-effort extra detail pulled out of companies.data (jsonb) using
// PostgREST JSON paths, so we never download the base64 logos that live
// in the same blob. A wrong path just returns null rather than erroring,
// so this can't break the dashboard if the JSON shape differs from what
// the Table Editor showed.
async function fetchCompanyDetails(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<CompanyDetail[]> {
  const { data, error } = await supabase
    .from("companies")
    .select(
      "user_id, province:data->settings->>province, hst_number:data->settings->>hstNumber, products:data->products, projects:data->projects"
    );
  if (error) return [];
  return (data as unknown as CompanyDetail[]) ?? [];
}

function arrayLength(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

export async function getMetrics(): Promise<Metrics> {
  const supabase = createSupabaseAdminClient();

  // Personal columns (email, full_name, company name) are now included —
  // this is an internal, admin-only view of your own product's users,
  // not a public surface.
  const [
    profilesResult,
    subsRes,
    companiesRes,
    authUsers,
    loginCounts,
    companyDetails,
    helcimRaw,
    usage,
  ] = await Promise.all([
    fetchProfiles(supabase),
    supabase
      .from("user_subscriptions")
      .select(
        "id, user_id, plan, status, current_period_end, created_at, updated_at"
      ),
    supabase.from("companies").select("id, user_id, name, created_at"),
    fetchAllAuthUsers(supabase),
    fetchLoginCounts(supabase),
    fetchCompanyDetails(supabase),
    getHelcimSummary().catch(() => EMPTY_HELCIM),
    fetchUsage(supabase),
  ]);

  if (subsRes.error) throw subsRes.error;
  if (companiesRes.error) throw companiesRes.error;

  // Test accounts (EXCLUDED_EMAILS) are removed up front, along with
  // everything that belongs to them, so every metric below ignores them.
  const exclude = buildExcludeMatcher(process.env.EXCLUDED_EMAILS);
  const excludedIds = new Set(
    profilesResult.data.filter((p) => exclude.matches(p.email)).map((p) => p.id)
  );
  const profiles = profilesResult.data.filter((p) => !excludedIds.has(p.id));
  const subs = (subsRes.data ?? []).filter((s) => !excludedIds.has(s.user_id));
  const companies = (companiesRes.data ?? []).filter(
    (c) => !excludedIds.has(c.user_id)
  );
  // ---- Helcim: drop test accounts, match subscriptions to users ----
  const emailToId = new Map<string, string>();
  for (const p of profiles) if (p.email) emailToId.set(p.email.toLowerCase(), p.id);
  const profileIds = new Set(profiles.map((p) => p.id));
  const hSubs: HelcimSubscription[] = helcimRaw.subscriptions
    .filter((s) => !exclude.matches(s.customerEmail))
    .map((s) => {
      if (s.customerCode && profileIds.has(s.customerCode))
        return { ...s, matchedUserId: s.customerCode, matchedBy: "customerCode" as const };
      const byEmail = s.customerEmail ? emailToId.get(s.customerEmail.toLowerCase()) : undefined;
      return byEmail ? { ...s, matchedUserId: byEmail, matchedBy: "email" as const } : s;
    })
    .filter((s) => !s.matchedUserId || !excludedIds.has(s.matchedUserId));
  // A user can have several Helcim subscriptions (old cancelled ones);
  // prefer an active one, then the most recently activated.
  const bestHelcimByUser = new Map<string, HelcimSubscription>();
  for (const s of hSubs) {
    if (!s.matchedUserId) continue;
    const cur = bestHelcimByUser.get(s.matchedUserId);
    const rank = (x: HelcimSubscription) => (x.status === "active" ? 2 : x.status === "term_ending" ? 1 : 0);
    if (!cur || rank(s) > rank(cur) || (rank(s) === rank(cur) && (s.dateActivated ?? "") > (cur.dateActivated ?? ""))) {
      bestHelcimByUser.set(s.matchedUserId, s);
    }
  }
  const helcimOk = helcimRaw.configured && !helcimRaw.error;
  const helcim: HelcimSummary = {
    ...helcimRaw,
    subscriptions: hSubs,
    ...summarizeSubscriptions(hSubs),
    unmatchedActive: hSubs.filter((s) => !s.matchedUserId && (s.status === "active" || s.status === "term_ending")).length,
  };

  const lastSignInByUser = new Map(
    authUsers.map((u) => [u.id, u.last_sign_in_at])
  );
  const authByUser = new Map(authUsers.map((u) => [u.id, u]));

  // Per-user rollup of the product/project/province detail pulled from
  // companies.data. A user can own several companies, so counts add up
  // and province/HST take the first non-empty value found.
  const detailByUser = new Map<
    string,
    { province: string | null; hst: boolean | null; products: number; projects: number }
  >();
  for (const c of companyDetails) {
    if (excludedIds.has(c.user_id)) continue;
    const cur = detailByUser.get(c.user_id) ?? {
      province: null,
      hst: null,
      products: 0,
      projects: 0,
    };
    cur.province = cur.province ?? (c.province || null);
    if (c.hst_number !== null && c.hst_number !== undefined) {
      cur.hst = (cur.hst ?? false) || c.hst_number.trim().length > 0;
    }
    cur.products += arrayLength(c.products);
    cur.projects += arrayLength(c.projects);
    detailByUser.set(c.user_id, cur);
  }

  const totalUsers = profiles.length;
  const totalCompanies = companies.length;
  const avgCompaniesPerUser = totalUsers > 0 ? totalCompanies / totalUsers : 0;

  const activeStatuses = new Set(["active", "trialing"]);

  const byStatus: Record<string, number> = {};
  const byPlan: Record<string, number> = {};
  const mrrByPlan: Record<string, number> = {};
  let mrr = 0;
  let activeCount = 0;

  for (const s of subs) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    if (activeStatuses.has(s.status)) {
      byPlan[s.plan] = (byPlan[s.plan] ?? 0) + 1;
      const price = priceForPlan(s.plan);
      mrr += price;
      mrrByPlan[s.plan] = (mrrByPlan[s.plan] ?? 0) + price;
      activeCount += 1;
    }
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const signupDates = profiles.map((p) => new Date(p.created_at));
  const signupsLast7 = signupDates.filter((d) => d >= sevenDaysAgo).length;
  const signupsLast30 = signupDates.filter((d) => d >= thirtyDaysAgo).length;
  const signupSeries = buildDailySeries(signupDates, 30);

  // Approximation: no dedicated canceled_at column exists, so a
  // cancellation is inferred from status === 'canceled' using the row's
  // updated_at as a proxy for "when it was canceled".
  const canceledDates = subs
    .filter((s) => s.status === "canceled")
    .map((s) => new Date(s.updated_at));
  const cancellationsLast30 = canceledDates.filter(
    (d) => d >= thirtyDaysAgo
  ).length;
  const cancellationSeries = buildDailySeries(canceledDates, 30);

  const inSevenDays = new Date(now);
  inSevenDays.setDate(now.getDate() + 7);
  const upcomingRenewals = subs
    .filter(
      (s) =>
        activeStatuses.has(s.status) &&
        s.current_period_end &&
        new Date(s.current_period_end) <= inSevenDays &&
        new Date(s.current_period_end) >= now
    )
    .sort(
      (a, b) =>
        new Date(a.current_period_end!).getTime() -
        new Date(b.current_period_end!).getTime()
    )
    .map((s) => ({
      maskedUser: maskId(s.user_id),
      plan: s.plan,
      date: s.current_period_end!,
    }));

  const signupActivity: ActivityItem[] = profiles
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .slice(0, 15)
    .map((p) => ({
      id: `signup-${p.id}`,
      type: "signup",
      label: "New signup",
      maskedUser: maskId(p.id),
      date: p.created_at,
    }));

  const statusActivity: ActivityItem[] = subs
    .slice()
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )
    .slice(0, 15)
    .map((s) => ({
      id: `status-${s.id}-${s.updated_at}`,
      type: "status_change",
      label: `Subscription ${s.status} (${s.plan})`,
      maskedUser: maskId(s.user_id),
      date: s.updated_at,
    }));

  const recentActivity = [...signupActivity, ...statusActivity]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 20);

  // Latest subscription per user (in case of historical rows).
  const latestSubByUser = new Map<string, (typeof subs)[number]>();
  for (const s of subs) {
    const existing = latestSubByUser.get(s.user_id);
    if (!existing || new Date(s.updated_at) > new Date(existing.updated_at)) {
      latestSubByUser.set(s.user_id, s);
    }
  }

  const firstCompanyAt = new Map<string, string>();
  for (const c of companies) {
    const cur = firstCompanyAt.get(c.user_id);
    if (c.created_at && (!cur || c.created_at < cur)) firstCompanyAt.set(c.user_id, c.created_at);
  }
  const companyNamesByUser = new Map<string, string[]>();
  for (const c of companies) {
    const list = companyNamesByUser.get(c.user_id) ?? [];
    list.push(c.name);
    companyNamesByUser.set(c.user_id, list);
  }

  // All subscription rows per user (not just latest) — needed to tell
  // whether someone *ever* trialed, since latestSubByUser only keeps
  // their current state.
  const allSubsByUser = new Map<string, typeof subs>();
  for (const s of subs) {
    const list = allSubsByUser.get(s.user_id) ?? [];
    list.push(s);
    allSubsByUser.set(s.user_id, list);
  }

  let everTrialed = 0;
  let converted = 0;
  let stillTrialing = 0;
  let canceledFromTrial = 0;
  for (const [userId, userSubs] of allSubsByUser) {
    const hasTrialed = userSubs.some((s) => s.status === "trialing");
    if (!hasTrialed) continue;
    everTrialed += 1;
    const latest = latestSubByUser.get(userId);
    if (latest?.status === "active") converted += 1;
    else if (latest?.status === "trialing") stillTrialing += 1;
    else if (latest?.status === "canceled") canceledFromTrial += 1;
  }

  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setDate(now.getDate() - 14);

  const subscriberList: SubscriberRow[] = profiles
    .map((p) => {
      const sub = latestSubByUser.get(p.id);
      const loginRow = loginCounts.byUser.get(p.id);
      // Prefer the audit-log-derived last_login when available (it's
      // exact); fall back to Auth's last_sign_in_at otherwise.
      const lastLoginAt = loginRow?.last_login ?? lastSignInByUser.get(p.id) ?? null;
      const companyCount = companyNamesByUser.get(p.id)?.length ?? 0;
      const hs = bestHelcimByUser.get(p.id);
      const joinedDate = new Date(p.created_at);
      const isActiveOrTrialing =
        sub?.status === "active" || sub?.status === "trialing";
      const isPaid = isActiveOrTrialing && !isFreePlan(sub?.plan);

      // Two independent "not actually using it" signals:
      //  1. Signed up a week+ ago and never created a single company.
      //  2. No login for 14+ days (or never).
      // The signals are the same for everyone, but the label differs:
      // "at risk" = a PAID subscriber who might churn; "inactive free" =
      // a free/unsubscribed user who isn't engaging (a nurture target,
      // not a revenue risk).
      let signal: string | null = null;
      if (companyCount === 0 && joinedDate <= sevenDaysAgo) {
        signal = "No company created since signup";
      } else if (!lastLoginAt && joinedDate <= fourteenDaysAgo) {
        signal = "Never logged in";
      } else if (lastLoginAt && new Date(lastLoginAt) <= fourteenDaysAgo) {
        signal = "No login in 14+ days";
      }
      const atRisk = isPaid && signal !== null;
      const atRiskReason = atRisk ? signal : null;
      const inactiveFree = !isPaid && signal !== null;
      const inactiveFreeReason = inactiveFree ? signal : null;

      // Prefer Helcim's next-billing date over the (possibly stale) Supabase
      // period end when we have a matched, active Helcim subscription.
      let renewalOverdueDays: number | null = null;
      const helcimDue = hs && (hs.status === "active" || hs.status === "term_ending") ? hs.dateBilling : null;
      const dueRaw = helcimDue ?? (isPaid ? sub?.current_period_end : null);
      if (dueRaw && (isPaid || helcimDue)) {
        const end = new Date(dueRaw);
        if (!Number.isNaN(end.getTime()) && end < now) {
          renewalOverdueDays = Math.floor((now.getTime() - end.getTime()) / 86_400_000);
        }
      }

      const detail0 = detailByUser.get(p.id);
      const usageRow = usage.available ? usage.byUser.get(p.id) ?? null : null;
      // "activated" (did a core bookkeeping task — see lib/activation.ts) is
      // only known once sql/crm_data.sql is installed; before that,
      // "building" is the top stage.
      const actions = coreActions(usageRow);
      const activationStage: ActivationStage =
        companyCount === 0
          ? "not_started"
          : actions.length > 0
            ? "activated"
            : (detail0?.products ?? 0) + (detail0?.projects ?? 0) > 0
              ? "building"
              : "set_up";

      const auth = authByUser.get(p.id);
      const detail = detailByUser.get(p.id);
      // Best captured label, in order: UTM source (+medium) from the
      // signup visit, then your first_touch_source, then
      // signup_touch_source. Never inferred — empty means "Not captured".
      const leadSource = p.signup_utm_source
        ? p.signup_utm_medium
          ? `${p.signup_utm_source} / ${p.signup_utm_medium}`
          : p.signup_utm_source
        : p.first_touch_source || p.signup_touch_source || "Not captured";

      return {
        id: p.id,
        email: p.email,
        fullName: p.full_name,
        companyNames: companyNamesByUser.get(p.id) ?? [],
        plan: sub?.plan ?? null,
        status: sub?.status ?? null,
        joinedAt: p.created_at,
        renewsAt: sub?.current_period_end ?? null,
        lastLoginAt,
        loginCount: loginCounts.available ? loginRow?.login_count ?? 0 : null,
        atRisk,
        atRiskReason,
        inactiveFree,
        inactiveFreeReason,
        isPaid,
        renewalOverdueDays,
        helcimStatus: hs?.status ?? null,
        helcimNextBilling: hs?.dateBilling ?? null,
        helcimFailed: hs?.hasFailedPayments ?? false,
        helcimMonthly: hs ? hs.monthlyAmount : null,
        signupReferrer: p.signup_referrer,
        signupSource: p.signup_utm_source,
        signupMedium: p.signup_utm_medium,
        signupCampaign: p.signup_utm_campaign,
        signupContent: p.signup_utm_content,
        signupTerm: p.signup_utm_term,
        firstTouchSource: p.first_touch_source,
        signupTouchSource: p.signup_touch_source,
        leadSource,
        signupMethod: auth?.provider ?? null,
        emailConfirmed: auth?.email_confirmed ?? false,
        activationStage,
        usage: usage.available ? usageRow ?? EMPTY_USAGE : null,
        activated: usage.available ? actions.length > 0 : null,
        coreActions: actions,
        companyCreatedAt: firstCompanyAt.get(p.id) ?? null,
        subHistory: (allSubsByUser.get(p.id) ?? [])
          .map((s) => ({ plan: s.plan ?? null, status: s.status ?? null, createdAt: s.created_at, updatedAt: s.updated_at }))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        companyCount,
        province: detail?.province ?? null,
        hstRegistered: detail?.hst ?? null,
        productCount: detail?.products ?? 0,
        projectCount: detail?.projects ?? 0,
      };
    })
    .sort(
      (a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime()
    );

  // ---- Supabase ↔ Helcim reconciliation ----
  const reconciliation: ReconIssue[] = [];
  if (helcimOk) {
    const todayStr = now.toISOString().slice(0, 10);
    const activeH = (s: HelcimSubscription) => s.status === "active" || s.status === "term_ending";
    for (const r of subscriberList) {
      const hs = bestHelcimByUser.get(r.id);
      const supa = { plan: r.plan, status: r.status, periodEnd: r.renewsAt };
      const base = { userId: r.id, email: r.email, name: r.fullName, supabase: supa };
      const h = hs ? { status: hs.status, monthly: hs.monthlyAmount, nextBilling: hs.dateBilling, failed: hs.hasFailedPayments } : null;
      if (r.isPaid && r.status === "active" && !hs) {
        reconciliation.push({ ...base, kind: "no_helcim_subscription", helcim: null, detail: `Supabase has ${r.plan} active but no matching Helcim subscription was found.` });
      } else if (hs && r.isPaid && r.status === "active" && !activeH(hs)) {
        reconciliation.push({ ...base, kind: "status_mismatch", helcim: h, detail: `Supabase: ${r.plan} active · Helcim: ${hs.status}.` });
      } else if (hs && activeH(hs) && hs.monthlyAmount > 0 && !r.isPaid) {
        reconciliation.push({ ...base, kind: "status_mismatch", helcim: h, detail: `Helcim: active ($${hs.monthlyAmount}/mo) · Supabase: ${r.plan ?? "no plan"} ${r.status ?? ""}.` });
      }
      if (hs && activeH(hs) && hs.hasFailedPayments) {
        reconciliation.push({ ...base, kind: "failed_payment", helcim: h, detail: "Helcim reports failed payments on this subscription." });
      }
      if (hs && activeH(hs) && hs.dateBilling && hs.dateBilling.slice(0, 10) < todayStr) {
        reconciliation.push({ ...base, kind: "billing_overdue", helcim: h, detail: `Next billing date ${hs.dateBilling.slice(0, 10)} has passed.` });
      }
    }
    for (const s of hSubs) {
      if (!s.matchedUserId && activeH(s)) {
        reconciliation.push({
          kind: "helcim_unmatched", userId: null, email: s.customerEmail, name: s.customerName, supabase: null,
          helcim: { status: s.status, monthly: s.monthlyAmount, nextBilling: s.dateBilling, failed: s.hasFailedPayments },
          detail: `Active Helcim subscription (customer ${s.customerCode ?? "?"}) doesn't match any user — check customerCode/email.`,
        });
      }
    }
  }

  const atRiskCount = subscriberList.filter((r) => r.atRisk).length;
  const inactiveFreeCount = subscriberList.filter((r) => r.inactiveFree).length;
  const paidSubscribers = subscriberList.filter((r) => r.isPaid).length;
  // "Set up" = has a company (includes people further along, "building").
  const setUpCount = subscriberList.filter(
    (r) => r.activationStage !== "not_started"
  ).length;
  const buildingCount = subscriberList.filter(
    (r) => r.activationStage === "building"
  ).length;
  const overdueRenewals = subscriberList
    .filter((r) => r.renewalOverdueDays !== null)
    .map((r) => ({
      maskedUser: maskId(r.id),
      plan: r.plan ?? "",
      status: r.status ?? "",
      periodEnd: r.renewsAt ?? "",
      daysOverdue: r.renewalOverdueDays ?? 0,
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const tally = (values: (string | null)[], fallback: string) => {
    const out: Record<string, number> = {};
    for (const v of values) {
      const key = v ?? fallback;
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  };

  const leadSources = tally(
    subscriberList.map((r) => r.leadSource),
    "Not captured"
  );
  const firstTouchSources = tally(
    subscriberList.map((r) => r.firstTouchSource || null),
    "Not captured"
  );
  const signupTouchSources = tally(
    subscriberList.map((r) => r.signupTouchSource || null),
    "Not captured"
  );
  const leadCampaigns = tally(
    subscriberList.map((r) => r.signupCampaign || null),
    "(none)"
  );
  const leadContents = tally(
    subscriberList.map((r) => r.signupContent || null),
    "(none)"
  );
  const signupMethods = tally(
    subscriberList.map((r) => r.signupMethod),
    "unknown"
  );
  const provinces = tally(
    subscriberList.filter((r) => r.companyCount > 0).map((r) => r.province),
    "Unknown"
  );
  const activationCounts: Record<ActivationStage, number> = {
    not_started: subscriberList.length - setUpCount,
    set_up: subscriberList.filter((r) => r.activationStage === "set_up").length,
    building: buildingCount,
    activated: subscriberList.filter((r) => r.activationStage === "activated").length,
  };
  const withUsage = subscriberList.filter((r) => r.usage);
  const daysToFirst = withUsage
    .filter((r) => r.usage!.firstInvoiceAt)
    .map((r) => Math.max(0, Math.round((new Date(r.usage!.firstInvoiceAt!).getTime() - new Date(r.joinedAt).getTime()) / 86_400_000)))
    .sort((a, b) => a - b);
  const adoption: Adoption | null = usage.available
    ? {
        users: withUsage.length,
        withInvoice: withUsage.filter((r) => r.usage!.invoices > 0).length,
        withSentInvoice: withUsage.filter((r) => r.usage!.invoicesSent > 0).length,
        withPaidInvoice: withUsage.filter((r) => r.usage!.invoicesPaid > 0).length,
        withClient: withUsage.filter((r) => r.usage!.clients > 0).length,
        withTimeEntry: withUsage.filter((r) => r.usage!.timeEntries > 0).length,
        withExpense: withUsage.filter((r) => r.usage!.expenses > 0).length,
        withBankStatement: withUsage.filter((r) => r.usage!.bankStatements > 0).length,
        withRecurring: withUsage.filter((r) => r.usage!.recurringInvoices + r.usage!.recurringExpenses > 0).length,
        totalInvoices: withUsage.reduce((n, r) => n + r.usage!.invoices, 0),
        totalInvoiced: Math.round(withUsage.reduce((n, r) => n + r.usage!.invoicedTotal, 0)),
        activated: withUsage.filter((r) => r.activated).length,
        medianDaysToFirstInvoice: daysToFirst.length ? daysToFirst[Math.floor(daysToFirst.length / 2)] : null,
      }
    : null;
  const productTotals = {
    products: subscriberList.reduce((n, r) => n + r.productCount, 0),
    projects: subscriberList.reduce((n, r) => n + r.projectCount, 0),
    usersWithProducts: subscriberList.filter((r) => r.productCount > 0).length,
    usersWithProjects: subscriberList.filter((r) => r.projectCount > 0).length,
  };

  return {
    totalUsers,
    totalCompanies,
    avgCompaniesPerUser,
    subscribers: {
      total: activeCount,
      byStatus,
      byPlan,
    },
    mrr,
    signups: {
      last7Days: signupsLast7,
      last30Days: signupsLast30,
      series: signupSeries,
    },
    cancellations: {
      last30Days: cancellationsLast30,
      series: cancellationSeries,
    },
    upcomingRenewals,
    recentActivity,
    subscriberList,
    loginCountsAvailable: loginCounts.available,
    trialConversion: {
      everTrialed,
      converted,
      stillTrialing,
      canceledFromTrial,
      rate: everTrialed > 0 ? converted / everTrialed : 0,
    },
    atRiskCount,
    inactiveFreeCount,
    paidSubscribers,
    freeUsers: subscriberList.length - paidSubscribers,
    overdueRenewals,
    pricingConfirmed: PRICING_FROM_ENV,
    setUpCount,
    attributionAvailable: profilesResult.attributionAvailable,
    planPricing: PLAN_PRICING,
    mrrByPlan,
    leadSources,
    firstTouchSources,
    signupTouchSources,
    leadCampaigns,
    leadContents,
    signupMethods,
    activationCounts,
    usageAvailable: usage.available,
    adoption,
    neverLoggedInCount: subscriberList.filter((r) => !r.lastLoginAt).length,
    unconfirmedEmailCount: subscriberList.filter((r) => !r.emailConfirmed)
      .length,
    provinces,
    productTotals,
    excludedTestAccounts: excludedIds.size,
    excludedAccounts: profilesResult.data
      .filter((p) => excludedIds.has(p.id))
      .map((p) => ({ email: p.email, joinedAt: p.created_at, matchedBy: exclude.matchingPattern(p.email) }))
      .sort((a, b) => b.joinedAt.localeCompare(a.joinedAt)),
    helcim,
    mrrActual: helcimOk ? helcim.mrr : null,
    reconciliation,
    mrrGoal: Number(process.env.MRR_GOAL) > 0 ? Number(process.env.MRR_GOAL) : null,
    eventTruth: (() => {
      const cutoff = thirtyDaysAgo.getTime();
      const cutoffDay = thirtyDaysAgo.toISOString().slice(0, 10);
      const since = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() >= cutoff : false);
      const activations = helcimOk
        ? { n: hSubs.filter((s) => since(s.dateActivated)).length, src: "helcim" as const }
        : { n: subs.filter((s) => !isFreePlan(s.plan) && since(s.created_at)).length, src: "supabase" as const };
      return {
        signups30: signupsLast30,
        companies30: companies.filter((c) => since(c.created_at)).length,
        firstInvoices30: usage.available ? subscriberList.filter((r) => r.usage?.firstInvoiceAt && r.usage.firstInvoiceAt >= cutoffDay).length : null,
        activations30: activations.n,
        activationsSource: activations.src,
      };
    })(),
    generatedAt: now.toISOString(),
  };
}
