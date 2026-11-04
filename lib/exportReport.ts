import type { Metrics, SubscriberRow } from "./metrics";
import { derivedStageOf } from "./crmStage";
import type { MarketingMetrics } from "./marketing";
import type { SeoBundle } from "./seo/types";
import type { Snapshot, Annotation, Post, MentionsResult, CrmData, MonitorStatus } from "./adminTypes";
import { buildTrackingRows } from "./tracking";
import { ACTIVATION_RULE } from "./activation";
import { cohortRetention, CHECKPOINTS } from "./cohorts";
import { diffAudits, diffBacklinks, cwvSeries } from "./seo/diff";
import { internalLinkSuggestions } from "./seo/internalLinks";
import { buildFunnel, campaignTable, postResults, CAMPAIGN_DIMS } from "./growth";
import { kpis, mrrMovements, goalProjection } from "./trends";

export type ExportInput = {
  metrics: Metrics;
  marketing: MarketingMetrics | null;
  marketingError: string | null;
  seo?: SeoBundle | null;
  crm?: { data: CrmData | null; loginDays: Record<string, string[]> | null } | null;
  growth?: { posts: Post[]; mentions: MentionsResult | null } | null;
  trends?: { snapshots: Snapshot[]; annotations: Annotation[] } | null;
  ops?: MonitorStatus | null;
  uiRange?: { label: string; from: string | null; to: string | null } | null; // what the dashboard header was set to
  includePersonalData: boolean;
};

// ---------- helpers ----------

const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
const money = (n: number) => `$${n.toFixed(2)}`;
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const maskId = (id: string) => `user_${id.replace(/-/g, "").slice(0, 8)}`;

function delta(cur: number, prev: number | undefined | null): string {
  if (prev === undefined || prev === null) return "";
  if (prev === 0) return cur === 0 ? " (no change)" : " (new vs 0 prior)";
  const d = ((cur - prev) / prev) * 100;
  return ` (${d >= 0 ? "+" : ""}${d.toFixed(1)}% vs prior, was ${prev})`;
}

function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  return String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function table(headers: string[], rows: unknown[][]): string {
  if (rows.length === 0) return "_No data._\n";
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}\n`;
}

function entries(rec: Record<string, number>, total?: number) {
  const sum = total ?? Object.values(rec).reduce((a, b) => a + b, 0);
  return Object.entries(rec)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => [k, v, sum > 0 ? pct(v / sum) : ""]);
}

function subscriberView(r: SubscriberRow, includePersonalData: boolean) {
  return {
    id: maskId(r.id),
    ...(includePersonalData
      ? {
          name: r.fullName,
          email: r.email,
          companies: r.companyNames,
        }
      : {}),
    plan: r.plan,
    status: r.status,
    joined: day(r.joinedAt),
    ageDays: Math.floor((Date.now() - new Date(r.joinedAt).getTime()) / 86_400_000),
    renewsAt: day(r.renewsAt),
    leadSource: r.leadSource,
    signupSource: r.signupSource,
    signupMedium: r.signupMedium,
    signupCampaign: r.signupCampaign,
    signupContent: r.signupContent,
    signupTerm: r.signupTerm,
    firstTouchSource: r.firstTouchSource,
    signupTouchSource: r.signupTouchSource,
    signupReferrer: r.signupReferrer,
    isPaid: r.isPaid,
    activated: r.activated,
    coreActions: r.coreActions,
    usage: r.usage,
    helcimStatus: r.helcimStatus,
    helcimNextBilling: day(r.helcimNextBilling),
    helcimFailed: r.helcimFailed,
    helcimMonthly: r.helcimMonthly,
    renewalOverdueDays: r.renewalOverdueDays,
    inactiveFree: r.inactiveFree,
    inactiveFreeReason: r.inactiveFreeReason,
    signupMethod: r.signupMethod,
    emailConfirmed: r.emailConfirmed,
    activationStage: r.activationStage,
    companyCount: r.companyCount,
    province: r.province,
    hstRegistered: r.hstRegistered,
    productCount: r.productCount,
    projectCount: r.projectCount,
    lastLogin: r.lastLoginAt,
    loginCount: r.loginCount,
    atRisk: r.atRisk,
    atRiskReason: r.atRiskReason,
  };
}

const NOTES = [
  "The dashboard's global date range and saved table views only change what is on screen. This export always contains the full data set; dashboardDateRange just records what the viewer had selected.",
  "Operations: uptime % is from checks this dashboard ran (history starts at the first check); domain expiry comes from RDAP or a manual MONITOR_DOMAIN_EXPIRY override. Alert text is omitted unless personal data is included.",
  "Test accounts matching EXCLUDED_EMAILS are removed from every figure here (see overview.excludedTestAccounts for how many).",
  "Dashboard for NorthBooks (a bookkeeping SaaS). Snapshot of Supabase subscriber data, Google Analytics 4 (GA4) and Google Search Console (SC).",
  "PRICING CAVEAT: plan prices come from config (PLAN_PRICES env or placeholder defaults), not from billing. See overview.pricingConfirmed — if false, the prices are unverified placeholders and MRR should not be trusted until confirmed.",
  "MRR is ESTIMATED: there is no price/transactions table, so it is active+trialing subscriptions multiplied by the monthly plan prices listed under planPricing. Trialing users on a priced plan are counted as paying in this estimate. Free plan = $0. Confirmed list prices: Pro $9/mo, Pro Plus $15/mo.",
  "Cancellations are APPROXIMATED: there is no canceled_at column, so a cancellation is a subscription with status='canceled' dated by its updated_at.",
  "'Subscribers (active)' counts subscriptions whose status is active or trialing.",
  "Trial conversion = users who were ever 'trialing' and are now 'active', divided by users who ever trialed.",
  "At-risk SUBSCRIBER = paid (active/trialing on a priced plan) AND (no company 7+ days after signup, never logged in, or no login in 14+ days). The same signals on free/unsubscribed users are reported separately as INACTIVE FREE (a nurture list, not revenue risk).",
  "Overdue renewals: paid active/trialing subscriptions whose current_period_end is in the past. Could be stale data, failed payments, or a webhook/sync issue — verify against the billing provider; billing is the source of truth, not this dashboard.",
  "Activation stages: not_started (no company) → set_up (has a company) → building (has created at least one product or project; the closest available proxy for a first meaningful action). True activation (first invoice/transaction) and 'returning' are not modeled because that data isn't available to the dashboard.",
  "Lead source = signup_utm_source / signup_utm_medium if present, else first_touch_source, else signup_touch_source; 'Not captured' if none. The profiles table also holds utm_campaign, utm_content, utm_term and referrer. 'Not captured' means attribution capture was not running when the person signed up (it cannot be backfilled). Use GA4 source/medium below for aggregate acquisition insight.",
  "GA4 window = last 30 days (incl. today); previous period = the 30 days before that. GA4 'key events' = conversions.",
  "Search Console window = 28 days ending 3 days before the export (SC data lags 2-3 days); previous period is the 28 days before. Country codes are ISO 3166-1 alpha-3.",
  "SEO tab: site-audit data comes from the dashboard's own crawler (cached from the last run — check the crawl date). Keyword/rank data is Search Console only (no keyword volumes or difficulty — those need paid tools). Backlinks come from Bing Webmaster Tools and are incomplete.",
  "Revenue tab: Helcim is the source of truth for money; Supabase for who is on what plan. 'Reconciliation' lists disagreements. Helcim customers are matched to users by customerCode == user id, else email; 'NO MATCH' rows need attention.",
  ACTIVATION_RULE + " Requires sql/crm_data.sql; usage counts come from companies.data (invoices and expenses live under fiscalYears[*]).",
  "CRM: pipeline stage is automatic (lead/trial/customer/at_risk/churned) unless set by hand. Cohort retention = any login in week N after signup; Supabase's auth log is only kept for a limited time.",
  "Growth: campaign tables only cover users with captured UTM data ('(none)' = unattributed). Post results match signups to a logged post by utm_campaign (+ utm_content). Rates on tiny samples are noisy.",
  "Trends: snapshots are taken daily from the first time capture ran; churn/LTV are trailing estimates and unreliable until ~30 days of history exist.",
  "Login counts come from the optional login-count SQL migration; null means it has not been enabled.",
  "Product/project counts come from the jsonb companies.data blob (products = sellable items, projects = client projects).",
];

// ---------- JSON ----------

export function buildJsonReport(input: ExportInput): string {
  const { metrics: m, marketing, marketingError, includePersonalData } = input;
  const report = {
    exportedAt: new Date().toISOString(),
    personalDataIncluded: includePersonalData,
    dashboardDateRange: input.uiRange ?? null, // informational only — the export itself is never range-filtered
    notesForAI: NOTES,
    overview: {
      totalUsers: m.totalUsers,
      totalCompanies: m.totalCompanies,
      avgCompaniesPerUser: m.avgCompaniesPerUser,
      activeOrTrialingSubscribers: m.subscribers.total,
      subscriptionsByStatus: m.subscribers.byStatus,
      activeOrTrialingByPlan: m.subscribers.byPlan,
      planPricingMonthly: m.planPricing,
      estimatedMrr: m.mrr,
      actualMrrHelcim: m.mrrActual,
      helcim: m.helcim.configured ? { error: m.helcim.error, activeCount: m.helcim.activeCount, mrr: m.helcim.mrr, failedPaymentCount: m.helcim.failedPaymentCount, pausedCount: m.helcim.pausedCount, overdueCount: m.helcim.overdueCount, upcoming7d: m.helcim.upcoming7d, last30: m.helcim.last30, months: m.helcim.months, warnings: m.helcim.warnings } : null,
      reconciliation: m.reconciliation,
      mrrGoal: m.mrrGoal,
      estimatedMrrByPlan: m.mrrByPlan,
      signups: m.signups,
      cancellations: m.cancellations,
      trialConversion: m.trialConversion,
      pricingConfirmed: m.pricingConfirmed,
      paidSubscribers: m.paidSubscribers,
      freeUsers: m.freeUsers,
      atRiskSubscriberCount: m.atRiskCount,
      inactiveFreeCount: m.inactiveFreeCount,
      overdueRenewals: m.overdueRenewals,
      setUpCount: m.setUpCount,
      activationCounts: m.activationCounts,
      neverLoggedInCount: m.neverLoggedInCount,
      unconfirmedEmailCount: m.unconfirmedEmailCount,
      leadSources: m.leadSources,
      firstTouchSources: m.firstTouchSources,
      signupTouchSources: m.signupTouchSources,
      leadCampaigns: m.leadCampaigns,
      leadContents: m.leadContents,
      signupMethods: m.signupMethods,
      provinces: m.provinces,
      productTotals: m.productTotals,
      upcomingRenewalsNext7Days: m.upcomingRenewals,
      recentActivity: m.recentActivity,
      loginCountsAvailable: m.loginCountsAvailable,
      attributionAvailable: m.attributionAvailable,
      excludedTestAccounts: m.excludedTestAccounts,
      dataGeneratedAt: m.generatedAt,
    },
    subscribers: m.subscriberList.map((r) =>
      subscriberView(r, includePersonalData)
    ),
    marketing: marketing
      ? { ga4: marketing.ga4, searchConsole: marketing.searchConsole }
      : { error: marketingError ?? "Marketing data not loaded" },
    seo: input.seo ? seoJson(input.seo) : { error: "SEO data not loaded" },
    crm: crmJson(m, input.crm ?? null, includePersonalData),
    growth: growthJson(m, input.growth ?? null, marketing?.ga4?.configured ? marketing.ga4.totalUsers : null),
    trackingCheck: buildTrackingRows(m.eventTruth, marketing?.ga4 ? { configured: marketing.ga4.configured, trackedEvents: marketing.ga4.trackedEvents } : null),
    revenue: revenueJson(m, includePersonalData),
    trends: input.trends ? trendsJson(input.trends, m.mrrGoal) : { error: "Trend history not loaded" },
    operations: input.ops ? opsJson(input.ops, includePersonalData) : { error: "Monitor data not loaded" },
  };
  return JSON.stringify(report, null, 2);
}

// ---------- SEO (JSON helpers) ----------

function seoJson(seo: SeoBundle) {
  const crawl = seo.crawl ? { ...seo.crawl, pages: seo.crawl.pages.map(({ outlinks, ...rest }) => { void outlinks; return rest; }) } : null;
  const audits = seo.history?.audits ?? [];
  const links = seo.history?.backlinks ?? [];
  return {
    ...seo,
    crawl,
    changesSincePreviousAudit: audits.length >= 2 ? diffAudits(audits[audits.length - 2], audits[audits.length - 1]) : null,
    backlinkChangesSincePrevious: links.length >= 2 ? diffBacklinks(links[links.length - 2], links[links.length - 1]) : null,
    internalLinkSuggestions: internalLinkSuggestions(seo.crawl, seo.opportunities, seo.opportunities.brand.terms),
  };
}

// ---------- CRM ----------



function crmJson(m: Metrics, c: ExportInput["crm"], pii: boolean) {
  const contacts = new Map((c?.data?.contacts ?? []).map((x) => [x.userId, x]));
  const stageOf = (r: Parameters<typeof derivedStageOf>[0]) => { const s = contacts.get(r.id)?.stage; return s || derivedStageOf(r); };
  const stages: Record<string, number> = {};
  for (const r of m.subscriberList) stages[stageOf(r)] = (stages[stageOf(r)] ?? 0) + 1;
  return {
    pipelineCounts: stages,
    followUps: (c?.data?.contacts ?? []).filter((x) => x.followUpOn).map((x) => {
      const r = m.subscriberList.find((s) => s.id === x.userId);
      return { user: pii ? (r?.email ?? x.userId) : maskId(x.userId), due: x.followUpOn, stage: x.stage, tags: x.tags };
    }),
    notes: pii ? (c?.data?.notes ?? []).map((n) => ({ user: m.subscriberList.find((s) => s.id === n.userId)?.email ?? n.userId, at: n.createdAt, body: n.body })) : { omitted: "personal data masked", count: c?.data?.notes.length ?? 0 },
    adoption: m.adoption,
    cohortRetention: c?.loginDays ? cohortRetention(m.subscriberList, c.loginDays) : { error: "login history not available (run sql/crm_data.sql)" },
  };
}

function buildCrmMarkdown(m: Metrics, c: ExportInput["crm"], pii: boolean): string {
  const out: string[] = ["\n## 4b. CRM tab (pipeline, adoption, retention)\n"];
  const j = crmJson(m, c, pii);
  out.push(table(["Stage", "Users"], Object.entries(j.pipelineCounts)));
  out.push("\n### Follow-ups scheduled\n");
  out.push(table(["User", "Due", "Stage", "Tags"], j.followUps.map((f) => [f.user, f.due, f.stage, f.tags.join(", ")])));
  out.push("\n### Notes\n");
  out.push(Array.isArray(j.notes) ? (j.notes.length ? j.notes.map((n) => `- ${n.at.slice(0, 10)} ${n.user}: ${n.body}`).join("\n") + "\n" : "_None._\n") : `_Omitted (personal data masked) — ${j.notes.count} notes._\n`);
  out.push("\n### Feature adoption\n");
  const a = m.adoption;
  out.push(a
    ? table(["Feature", "Users", "% of users"], ([["Activated (any core task)", a.activated], ["Created an invoice", a.withInvoice], ["Sent an invoice", a.withSentInvoice], ["Invoice paid", a.withPaidInvoice], ["Added a client", a.withClient], ["Logged time", a.withTimeEntry], ["Tracked an expense", a.withExpense], ["Uploaded a bank statement", a.withBankStatement], ["Uses recurring items", a.withRecurring]] as [string, number][]).map(([l, n]) => [l, n, pct(n / (a.users || 1), 0)])) + `\n${a.totalInvoices} invoices created (${money(a.totalInvoiced)} invoiced); median ${a.medianDaysToFirstInvoice ?? "n/a"} days from signup to first invoice.\n`
    : "_Usage data not available — run sql/crm_data.sql._\n");
  out.push("\n### Cohort retention (share of each signup-week cohort that logged in during week N after signup)\n");
  out.push(Array.isArray(j.cohortRetention)
    ? table(["Signup week", "Signups", ...CHECKPOINTS.map((n) => `Week ${n}`)], j.cohortRetention.map((r) => [r.week, r.size, ...CHECKPOINTS.map((n) => (r.retained[n] ? `${pct(r.retained[n]!.pct, 0)} (${r.retained[n]!.n})` : "—"))]))
    : "_Login history not available — run sql/crm_data.sql._\n");
  return out.join("\n");
}

// ---------- Growth ----------

function growthJson(m: Metrics, g: ExportInput["growth"], visitors: number | null) {
  const rows = m.subscriberList;
  return {
    funnelLast30Days: buildFunnel(rows, 30, visitors),
    funnelLast90Days: buildFunnel(rows, 90, null),
    funnelAllTime: buildFunnel(rows, null, null),
    campaigns: Object.fromEntries(CAMPAIGN_DIMS.map((d) => [d.label, campaignTable(rows, d.id, m.planPricing)])),
    loggedPosts: g ? postResults(g.posts, rows, m.planPricing) : { error: "Post log not loaded" },
    mentions: g?.mentions ? { terms: g.mentions.terms, sources: g.mentions.sources, items: g.mentions.items.map(({ isNew, ...i }) => ({ ...i, new: isNew })) } : { error: "Mentions not loaded" },
  };
}

function buildGrowthMarkdown(m: Metrics, g: ExportInput["growth"], visitors: number | null, ga4?: MarketingMetrics["ga4"] | null): string {
  const out: string[] = ["\n## 5. Growth tab (funnel, campaigns, posts, mentions)\n"];
  const rows = m.subscriberList;
  const funnel = (title: string, days: number | null, v: number | null) => {
    out.push(`\n### Funnel — ${title}\n`);
    out.push(table(["Step", "Count", "% of previous", "% of first"], buildFunnel(rows, days, v).map((s) => [s.label, s.count ?? "n/a", s.ofPrev === null ? "" : pct(s.ofPrev), s.ofFirst === null ? "" : pct(s.ofFirst)])));
  };
  {
    const tr = buildTrackingRows(m.eventTruth, ga4 ? { configured: ga4.configured, trackedEvents: ga4.trackedEvents } : null);
    out.push("\n### GA4 conversion-event check (last 30 days)\n");
    out.push(table(["Event", "GA4", "Your data", "Compared with", "Match", "Status", "Note"], tr.map((r) => [r.event, r.ga4, r.backend, r.backendLabel, r.ratio === null ? "" : pct(r.ratio, 0), r.status, r.note])));
    if (ga4?.configured && ga4.piiUrlHits !== null) out.push(`Page URLs with an email-like "@": ${ga4.piiUrlHits} page views.\n`);
  }
  funnel("signed up in last 30 days (visitors = GA4 users, 30d)", 30, visitors);
  funnel("signed up in last 90 days", 90, null);
  funnel("all signups", null, null);
  for (const d of CAMPAIGN_DIMS) {
    out.push(`\n### Campaign performance by ${d.label}\n`);
    out.push(table(["Value", "Signups", "Set up", "Building", "Activated", "Ever logged in", "Paid", "Paid %", "MRR", "First", "Latest"],
      campaignTable(rows, d.id, m.planPricing).sort((a, b) => b.signups - a.signups).map((c) => [c.key, c.signups, `${c.setUp} (${pct(c.setUpRate, 0)})`, `${c.building} (${pct(c.buildingRate, 0)})`, `${c.activated} (${pct(c.activatedRate, 0)})`, c.loggedIn, c.paid, pct(c.paidRate, 0), money(c.mrr), c.firstSignup, c.lastSignup])));
  }
  out.push("\n### Logged posts & results\n");
  out.push(g ? table(["Posted", "Platform", "Title", "Campaign", "Content", "Signups", "First 7d", "Set up", "Paid", "MRR", "Notes"],
    postResults(g.posts, rows, m.planPricing).map((p) => [p.postedOn, p.platform, p.title, p.utmCampaign, p.utmContent, p.signups, p.signups7d, p.setUp, p.paid, money(p.mrr), p.notes])) : "_Post log not loaded._\n");
  out.push("\n### Brand mentions (Hacker News / Reddit / Google Alerts)\n");
  if (g?.mentions) {
    out.push(`Terms: ${g.mentions.terms.join(", ")} · ${g.mentions.sources.map((s) => `${s.name}: ${s.ok ? s.count + " found" : "unavailable (" + s.error + ")"}`).join(" · ")}\n`);
    out.push(table(["Date", "Source", "Where", "Mention", "URL", "New"], g.mentions.items.slice(0, 60).map((i) => [i.date.slice(0, 10), i.source, i.context, i.title, i.url, i.isNew ? "yes" : ""])));
  } else out.push("_Mentions not loaded._\n");
  return out.join("\n");
}

// ---------- Revenue / trends ----------

const who = (pii: boolean, name: string | null, email: string | null, id?: string | number | null) =>
  pii ? [name, email].filter(Boolean).join(" · ") : id ? `sub_${String(id)}` : "";

function revenueJson(m: Metrics, pii: boolean) {
  const h = m.helcim;
  if (!h.configured) return { configured: false };
  return {
    configured: true,
    error: h.error,
    warnings: h.warnings,
    fetchedAt: h.fetchedAt,
    actualMrr: m.mrrActual,
    estimatedMrr: m.mrr,
    statusCounts: h.byStatus,
    failedPaymentCount: h.failedPaymentCount,
    overdueCount: h.overdueCount,
    pausedCount: h.pausedCount,
    unmatchedActive: h.unmatchedActive,
    upcoming7d: h.upcoming7d,
    last30: h.last30,
    months: h.months,
    plans: h.plans,
    subscriptions: h.subscriptions.map((s) => ({
      ref: who(pii, s.customerName, s.customerEmail, s.id),
      plan: s.planName,
      status: s.status,
      monthly: s.monthlyAmount,
      recurringAmount: s.recurringAmount,
      billingPeriod: s.billingPeriod,
      activated: day(s.dateActivated),
      nextBilling: day(s.dateBilling),
      timesBilled: s.timesBilled,
      failedPayments: s.hasFailedPayments,
      matchedBy: s.matchedBy,
    })),
    recentDeclines: h.recentDeclines.map((t) => ({ date: day(t.date), amount: t.amount, customerCode: pii ? t.customerCode : null, cardType: t.cardType })),
    reconciliation: m.reconciliation.map((r) => ({
      kind: r.kind,
      user: pii ? who(true, r.name, r.email) : r.userId ? maskId(r.userId) : null,
      supabase: r.supabase,
      helcim: r.helcim,
      detail: pii ? r.detail : r.detail.replace(/customer [^\s)]+/, "customer ?"),
    })),
  };
}

function buildRevenueMarkdown(m: Metrics, pii: boolean): string {
  const h = m.helcim;
  const out: string[] = [];
  out.push("\n## 6. Revenue tab (Helcim)\n");
  if (!h.configured) return out.join("\n") + "\nHelcim not configured (HELCIM_API_TOKEN).\n";
  if (h.error) out.push(`Helcim error: ${h.error}\n`);
  if (h.warnings.length) out.push(`Warnings: ${h.warnings.join(" · ")}\n`);
  out.push(
    [
      `- Actual MRR: ${m.mrrActual === null ? "n/a" : money(m.mrrActual)} (plan-price estimate ${money(m.mrr)})`,
      `- Subscriptions by status: ${Object.entries(h.byStatus).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`,
      `- Failed-payment: ${h.failedPaymentCount} · overdue billing: ${h.overdueCount} · paused: ${h.pausedCount} · active with no matching user: ${h.unmatchedActive}`,
      `- Next 7 days: ${h.upcoming7d.count} billings, ${money(h.upcoming7d.amount)}`,
      `- Last 30 days: gross ${money(h.last30.gross)}, refunds ${money(h.last30.refunds)}, net ${money(h.last30.net)}, approved ${h.last30.approved}, declined ${h.last30.declined}`,
      m.mrrGoal ? `- MRR goal: ${money(m.mrrGoal)}` : "",
    ].filter(Boolean).join("\n") + "\n"
  );
  out.push("\n### Reconciliation (Supabase vs Helcim)\n");
  out.push(
    table(
      ["Issue", "User", "Supabase", "Helcim", "Detail"],
      m.reconciliation.map((r) => [
        r.kind,
        pii ? who(true, r.name, r.email) : r.userId ? maskId(r.userId) : "",
        r.supabase ? `${r.supabase.plan ?? "-"} / ${r.supabase.status ?? "-"}` : "",
        r.helcim ? `${r.helcim.status}, $${r.helcim.monthly}/mo, next ${day(r.helcim.nextBilling)}${r.helcim.failed ? ", FAILED" : ""}` : "",
        r.detail,
      ])
    )
  );
  out.push("\n### Subscriptions\n");
  out.push(
    table(
      ["Ref", "Plan", "Status", "$/mo", "Period", "Activated", "Next billing", "Billed", "Failed", "Matched by"],
      h.subscriptions.map((s) => [
        who(pii, s.customerName, s.customerEmail, s.id), s.planName, s.status, s.monthlyAmount, s.billingPeriod,
        day(s.dateActivated), day(s.dateBilling), s.timesBilled, s.hasFailedPayments ? "yes" : "", s.matchedBy ?? "NO MATCH",
      ])
    )
  );
  out.push("\n### Revenue by month\n");
  out.push(table(["Month", "Gross", "Refunds", "Net", "Approved", "Declined"], h.months.map((r) => [r.month, r.gross, r.refunds, r.net, r.approved, r.declined])));
  out.push("\n### Recent declines\n");
  out.push(table(["Date", "Amount", "Customer code"], h.recentDeclines.map((t) => [day(t.date), t.amount, pii ? t.customerCode : ""])));
  return out.join("\n");
}

function trendsJson(t: { snapshots: Snapshot[]; annotations: Annotation[] }, goal: number | null) {
  const k = kpis(t.snapshots);
  return {
    snapshotCount: t.snapshots.length,
    kpis: k,
    goal: goal ? { goal, ...goalProjection(t.snapshots, goal) } : null,
    annotations: t.annotations,
    movements: mrrMovements(t.snapshots),
    // Per-subscriber detail is omitted; aggregates only.
    daily: t.snapshots.map((s) => ({ day: s.day, ...s.data, subscribers: undefined })),
  };
}

function buildTrendsMarkdown(t: { snapshots: Snapshot[]; annotations: Annotation[] }, goal: number | null): string {
  const out: string[] = [];
  const s = t.snapshots;
  out.push("\n## 7. Trends tab (daily snapshots)\n");
  if (!s.length) return out.join("\n") + "\nNo snapshots yet — history starts when the first one is captured.\n";
  const k = kpis(s);
  out.push(
    [
      `Snapshots: ${s.length} (${s[0].day} → ${s[s.length - 1].day}). History only exists from the first snapshot; earlier dates cannot be backfilled.`,
      `- ARPU ${k.arpu === null ? "n/a" : money(k.arpu)} · monthly logo churn ${k.monthlyLogoChurn === null ? "n/a (need ~7+ days)" : pct(k.monthlyLogoChurn)} · revenue churn ${k.monthlyRevenueChurn === null ? "n/a" : pct(k.monthlyRevenueChurn)} · LTV ${k.ltv === null ? "n/a" : money(k.ltv)} · net new MRR/30d ${k.netNewMrr30 === null ? "n/a" : money(k.netNewMrr30)}`,
      goal ? `- MRR goal ${money(goal)}: ${(() => { const g = goalProjection(s, goal); return `${pct(g.pct, 0)} reached${g.eta ? `, on pace for ~${g.eta}` : ""}`; })()}` : "",
    ].filter(Boolean).join("\n") + "\n"
  );
  out.push("\n### Daily snapshots\n");
  out.push(
    table(
      ["Day", "MRR", "Src", "Users", "Paid", "Free", "Signups 30d", "Cancels 30d", "At risk", "Setup", "Building", "GA sessions", "GSC clicks", "Helcim failed"],
      s.map((x) => [x.day, x.data.mrr, x.data.mrrSource, x.data.users, x.data.paid, x.data.free, x.data.signups30, x.data.cancellations30, x.data.atRisk, x.data.setUp, x.data.building, x.data.ga?.sessions, x.data.sc?.clicks, x.data.helcim?.failed])
    )
  );
  out.push("\n### MRR movement\n");
  out.push(table(["Day", "Start", "New", "Expansion", "Contraction", "Churn", "End"], mrrMovements(s).filter((m) => m.new || m.expansion || m.contraction || m.churn).map((m) => [m.day, m.start, m.new, m.expansion, m.contraction, m.churn, m.end])));
  out.push("\n### Annotations\n");
  out.push(t.annotations.length ? t.annotations.map((a) => `- ${a.day}: ${a.label}`).join("\n") + "\n" : "_None._\n");
  return out.join("\n");
}

// ---------- Markdown ----------

export function buildMarkdownReport(input: ExportInput): string {
  const { metrics: m, marketing, marketingError, includePersonalData } = input;
  const out: string[] = [];
  const h = (level: number, t: string) => out.push(`\n${"#".repeat(level)} ${t}\n`);
  const p = (t: string) => out.push(`${t}\n`);

  out.push(`# NorthBooks Dashboard Export`);
  p(
    `Exported: ${new Date().toISOString()} · Data generated: ${m.generatedAt} · Personal data: ${includePersonalData ? "INCLUDED" : "masked"}` +
      (input.uiRange && (input.uiRange.from || input.uiRange.to) ? ` · Dashboard was viewing: ${input.uiRange.label} (export still contains ALL data)` : "")
  );

  h(2, "Notes for the AI reader");
  p(NOTES.map((n) => `- ${n}`).join("\n"));

  // ---- Overview ----
  h(2, "1. Overview tab");
  h(3, "Headline numbers");
  p(
    [
      `- Total users (profiles): ${m.totalUsers} (${m.excludedTestAccounts} test accounts excluded)`,
      `- Active + trialing subscribers: ${m.subscribers.total}`,
      `- Estimated MRR (plan prices): ${money(m.mrr)}`,
      m.helcim.configured && !m.helcim.error
        ? `- ACTUAL MRR (Helcim): ${money(m.helcim.mrr)}; active subs ${m.helcim.activeCount}, failed-payment subs ${m.helcim.failedPaymentCount}, paused ${m.helcim.pausedCount}, overdue billing ${m.helcim.overdueCount}; last 30d gross ${money(m.helcim.last30.gross)}, net ${money(m.helcim.last30.net)}, declines ${m.helcim.last30.declined}`
        : `- Helcim: ${m.helcim.configured ? `error — ${m.helcim.error}` : "not configured (HELCIM_API_TOKEN)"}`,
      `- Supabase↔Helcim reconciliation issues: ${m.reconciliation.length}${m.reconciliation.length ? "\n" + m.reconciliation.slice(0, 25).map((r) => `  - [${r.kind}] ${r.email ?? "?"}: ${r.detail}`).join("\n") : ""}`,
      `- Total companies: ${m.totalCompanies} (avg ${m.avgCompaniesPerUser.toFixed(2)} per user)`,
      `- Signups: ${m.signups.last7Days} in last 7 days, ${m.signups.last30Days} in last 30 days`,
      `- Cancellations (approx.) last 30 days: ${m.cancellations.last30Days}`,
      `- Paid subscribers: ${m.paidSubscribers}; free/unsubscribed: ${m.freeUsers}`,
      `- Pricing confirmed: ${m.pricingConfirmed ? "yes (PLAN_PRICES)" : "NO — placeholder prices, MRR unverified"}`,
      `- At-risk PAID subscribers: ${m.atRiskCount}; inactive free users: ${m.inactiveFreeCount}`,
      `- Paid subscriptions with a past renewal date: ${m.overdueRenewals.length}`,
      `- Set up (has a company): ${m.setUpCount} of ${m.totalUsers}`,
      `- Never logged in: ${m.neverLoggedInCount}`,
      `- Unconfirmed emails: ${m.unconfirmedEmailCount}`,
      `- Products created: ${m.productTotals.products} (by ${m.productTotals.usersWithProducts} users); projects: ${m.productTotals.projects} (by ${m.productTotals.usersWithProjects} users)`,
    ].join("\n")
  );

  h(3, "Subscriptions by status (all rows)");
  p(table(["Status", "Count", "Share"], entries(m.subscribers.byStatus)));

  h(3, "Active + trialing by plan, with estimated MRR");
  p(
    table(
      ["Plan", "Subscribers", "Monthly price", "Est. MRR"],
      Object.keys({ ...m.subscribers.byPlan, ...m.mrrByPlan }).map((plan) => [
        plan,
        m.subscribers.byPlan[plan] ?? 0,
        money(m.planPricing[plan] ?? 0),
        money(m.mrrByPlan[plan] ?? 0),
      ])
    )
  );

  h(3, "Trial conversion");
  const t = m.trialConversion;
  p(
    `Ever trialed: ${t.everTrialed} · Converted to active: ${t.converted} · Still trialing: ${t.stillTrialing} · Canceled from trial: ${t.canceledFromTrial} · Rate: ${pct(t.rate)}`
  );

  h(3, "Activation");
  p(table(["Stage", "Users"], Object.entries(m.activationCounts)));
  p(m.adoption ? `${ACTIVATION_RULE} Activated: ${m.adoption.activated} of ${m.adoption.users} users (${pct(m.adoption.activated / (m.adoption.users || 1), 0)}).` : `${ACTIVATION_RULE} (Not measurable yet — run sql/crm_data.sql.)`);

  h(3, "Lead sources (signups)");
  if (!m.attributionAvailable) {
    p(
      "_Attribution columns not enabled yet — every user shows as 'Not captured'._"
    );
  }
  p(table(["Lead source", "Users", "Share"], entries(m.leadSources, m.totalUsers)));

  h(3, "First-touch source (profiles.first_touch_source)");
  p(table(["Source", "Users", "Share"], entries(m.firstTouchSources, m.totalUsers)));
  h(3, "Signup-touch source (profiles.signup_touch_source)");
  p(table(["Source", "Users", "Share"], entries(m.signupTouchSources, m.totalUsers)));
  h(3, "UTM campaign at signup");
  p(table(["Campaign", "Users", "Share"], entries(m.leadCampaigns, m.totalUsers)));
  h(3, "UTM content at signup (which post/variant)");
  p(table(["Content", "Users", "Share"], entries(m.leadContents, m.totalUsers)));

  h(3, "Signup methods");
  p(table(["Method", "Users", "Share"], entries(m.signupMethods, m.totalUsers)));

  h(3, "Provinces (users with a company)");
  p(table(["Province", "Users", "Share"], entries(m.provinces)));

  h(3, "Signups per day (last 30 days)");
  p(table(["Date", "Signups"], m.signups.series.map((d) => [d.date, d.count])));

  h(3, "Cancellations per day (last 30 days, approx.)");
  p(
    table(
      ["Date", "Cancellations"],
      m.cancellations.series.filter((d) => d.count > 0).map((d) => [d.date, d.count])
    )
  );

  h(3, "Overdue renewals (paid, period end in the past)");
  p(
    table(
      ["User", "Plan", "Status", "Period ended", "Days overdue"],
      m.overdueRenewals.map((r) => [r.maskedUser, r.plan, r.status, day(r.periodEnd), r.daysOverdue])
    )
  );

  h(3, "Upcoming renewals (next 7 days)");
  p(
    table(
      ["User", "Plan", "Renews"],
      m.upcomingRenewals.map((r) => [r.maskedUser, r.plan, day(r.date)])
    )
  );

  h(3, "Recent activity");
  p(
    table(
      ["When", "Type", "Detail", "User"],
      m.recentActivity.map((a) => [a.date, a.type, a.label, a.maskedUser])
    )
  );

  // ---- Subscribers ----
  h(2, `2. Subscribers tab (${m.subscriberList.length} users, newest first)`);
  const headers = [
    "ID",
    ...(includePersonalData ? ["Name", "Email", "Company"] : []),
    "Plan",
    "Status",
    "Setup",
    "Activated",
    "Joined",
    "Age (d)",
    "Renews",
    "Lead source",
    "Campaign",
    "Content",
    "First touch",
    "Signup touch",
    "Referrer",
    "Paid",
    "Auth",
    "Email ok",
    "Cos",
    "Prov",
    "HST",
    "Prods",
    "Projs",
    "Last login",
    "Logins",
    "Risk / inactivity",
    "Invoices",
    "Sent",
    "Paid inv.",
    "Invoiced $",
    "Clients",
    "Time entries",
    "Expenses",
    "Bank stmts",
    "Helcim status",
    "Helcim next billing",
    "Helcim $/mo",
    "Helcim failed",
  ];
  p(
    table(
      headers,
      m.subscriberList.map((r) => {
        const v = subscriberView(r, includePersonalData);
        return [
          v.id,
          ...(includePersonalData
            ? [r.fullName, r.email, r.companyNames.join("; ")]
            : []),
          v.plan,
          v.status,
          v.activationStage,
          v.activated === null ? "n/a" : v.activated ? v.coreActions.join("+") : "no",
          v.joined,
          v.ageDays,
          v.renewalOverdueDays !== null ? `${v.renewsAt} (OVERDUE ${v.renewalOverdueDays}d)` : v.renewsAt,
          v.leadSource,
          v.signupCampaign,
          v.signupContent,
          v.firstTouchSource,
          v.signupTouchSource,
          v.signupReferrer,
          v.isPaid ? "yes" : "no",
          v.signupMethod,
          v.emailConfirmed ? "yes" : "no",
          v.companyCount,
          v.province,
          v.hstRegistered === null ? "" : v.hstRegistered ? "yes" : "no",
          v.productCount,
          v.projectCount,
          v.lastLogin ? v.lastLogin.slice(0, 16).replace("T", " ") : "never",
          v.loginCount === null ? "n/a" : v.loginCount,
          v.atRisk
            ? `AT RISK: ${v.atRiskReason}`
            : v.inactiveFree
              ? `inactive free: ${v.inactiveFreeReason}`
              : "",
          v.usage?.invoices, v.usage?.invoicesSent, v.usage?.invoicesPaid, v.usage?.invoicedTotal, v.usage?.clients, v.usage?.timeEntries, v.usage?.expenses, v.usage?.bankStatements,
          v.helcimStatus,
          v.helcimNextBilling,
          v.helcimMonthly,
          v.helcimFailed ? "yes" : "",
        ];
      })
    )
  );

  // ---- Marketing ----
  h(2, "3. Marketing tab");
  if (!marketing) {
    p(`_Marketing data unavailable: ${marketingError ?? "not loaded"}_`);
  } else {
    const g = marketing.ga4;
    const sc = marketing.searchConsole;

    h(3, "Google Analytics 4 (last 30 days)");
    if (!g.configured) {
      p("_GA4 not configured._");
    } else {
      const pp = g.previousPeriod;
      p(
        [
          `- Sessions: ${g.sessions}${delta(g.sessions, pp?.sessions)}`,
          `- Total users: ${g.totalUsers}${delta(g.totalUsers, pp?.totalUsers)}`,
          `- New users: ${g.newUsers}${delta(g.newUsers, pp?.newUsers)}`,
          `- Key events (conversions): ${g.conversions}${delta(g.conversions, pp?.conversions)}`,
          `- Engaged sessions: ${g.engagedSessions}${delta(g.engagedSessions, pp?.engagedSessions)}`,
          `- Engagement rate: ${pct(g.engagementRate)}${pp ? ` (prior ${pct(pp.engagementRate)})` : ""}`,
          `- Avg session duration: ${g.avgEngagementSeconds.toFixed(0)}s${pp ? ` (prior ${pp.avgEngagementSeconds.toFixed(0)}s)` : ""}`,
          `- New vs returning sessions: ${g.newVsReturning.new} new / ${g.newVsReturning.returning} returning`,
        ].join("\n")
      );
      if (g.warnings.length)
        p(`_Some GA4 reports failed: ${g.warnings.join(" | ")}_`);

      h(4, "Traffic by channel");
      p(table(["Channel", "Sessions"], g.byChannel.map((c) => [c.channel, c.sessions])));
      h(4, "Source / medium");
      p(
        table(
          ["Source / medium", "Sessions", "New users", "Engagement", "Key events"],
          g.bySourceMedium.map((s) => [
            s.sourceMedium,
            s.sessions,
            s.newUsers,
            pct(s.engagementRate),
            s.keyEvents,
          ])
        )
      );
      h(4, "Campaigns");
      p(
        table(
          ["Campaign", "Sessions", "Key events"],
          g.byCampaign.map((c) => [c.campaign, c.sessions, c.keyEvents])
        )
      );
      h(4, "Top landing pages");
      p(
        table(
          ["Page", "Sessions", "New users", "Engagement", "Key events"],
          g.topLandingPages.map((l) => [
            l.page,
            l.sessions,
            l.newUsers,
            pct(l.engagementRate),
            l.keyEvents,
          ])
        )
      );
      h(4, "Top pages by views");
      p(
        table(
          ["Page", "Views", "Users"],
          g.topPages.map((x) => [x.page, x.views, x.users])
        )
      );
      h(4, "Top events");
      p(
        table(
          ["Event", "Count", "Users"],
          g.topEvents.map((e) => [e.event, e.count, e.users])
        )
      );
      h(4, "Device");
      p(table(["Device", "Sessions"], g.byDevice.map((d) => [d.device, d.sessions])));
      h(4, "Country");
      p(table(["Country", "Sessions"], g.byCountry.map((d) => [d.country, d.sessions])));
      h(4, "City");
      p(table(["City", "Sessions"], g.byCity.map((d) => [d.city, d.sessions])));
      h(4, "Browser");
      p(table(["Browser", "Sessions"], g.byBrowser.map((d) => [d.browser, d.sessions])));
      h(4, "Daily trend");
      p(
        table(
          ["Date", "Sessions", "Users", "New users", "Key events"],
          g.dailySessions.map((d) => [d.date, d.sessions, d.users, d.newUsers, d.keyEvents])
        )
      );
    }

    h(3, "Google Search Console");
    if (!sc.configured) {
      p("_Search Console not configured._");
    } else {
      const pv = sc.previousPeriod;
      p(
        [
          `- Window: ${sc.window?.startDate} to ${sc.window?.endDate}${pv ? ` (prior: ${pv.startDate} to ${pv.endDate})` : ""}`,
          `- Clicks: ${sc.clicks}${delta(sc.clicks, pv?.clicks)}`,
          `- Impressions: ${sc.impressions}${delta(sc.impressions, pv?.impressions)}`,
          `- CTR: ${pct(sc.ctr, 2)}${pv ? ` (prior ${pct(pv.ctr, 2)})` : ""}`,
          `- Avg position: ${sc.position.toFixed(1)}${pv ? ` (prior ${pv.position.toFixed(1)})` : ""}`,
        ].join("\n")
      );
      if (sc.warnings.length)
        p(`_Some Search Console reports failed: ${sc.warnings.join(" | ")}_`);

      const perf = (x: { clicks: number; impressions: number; ctr: number; position: number }) => [
        x.clicks,
        x.impressions,
        pct(x.ctr, 2),
        x.position.toFixed(1),
      ];
      const perfHead = ["Clicks", "Impr.", "CTR", "Pos."];
      h(4, "Top queries");
      p(table(["Query", ...perfHead], sc.topQueries.map((q) => [q.query, ...perf(q)])));
      h(4, "Top pages");
      p(table(["Page", ...perfHead], sc.topPages.map((q) => [q.page, ...perf(q)])));
      h(4, "Query → page");
      p(
        table(
          ["Query", "Page", ...perfHead],
          sc.queryPages.map((q) => [q.query, q.page, ...perf(q)])
        )
      );
      h(4, "Device");
      p(
        table(
          ["Device", "Clicks", "Impressions"],
          sc.byDevice.map((d) => [d.device, d.clicks, d.impressions])
        )
      );
      h(4, "Country");
      p(
        table(
          ["Country", "Clicks", "Impressions"],
          sc.byCountry.map((d) => [d.country, d.clicks, d.impressions])
        )
      );
      h(4, "Daily trend");
      p(
        table(
          ["Date", "Clicks", "Impressions"],
          sc.dailyTrend.map((d) => [d.date, d.clicks, d.impressions])
        )
      );
    }
  }

  out.push(buildCrmMarkdown(m, input.crm ?? null, includePersonalData));
  out.push(buildGrowthMarkdown(m, input.growth ?? null, marketing?.ga4?.configured ? marketing.ga4.totalUsers : null, marketing?.ga4));
  out.push(buildRevenueMarkdown(m, includePersonalData));
  if (input.trends) out.push(buildTrendsMarkdown(input.trends, m.mrrGoal));
  if (input.ops) out.push(buildOpsMarkdown(input.ops, includePersonalData));
  if (input.seo) out.push(buildSeoMarkdown(input.seo));

  return out.join("\n");
}

export function buildSeoMarkdown(seo: SeoBundle): string {
  const out: string[] = [];
  const h = (level: number, t: string) => out.push(`\n${"#".repeat(level)} ${t}\n`);
  const p = (t: string) => out.push(`${t}\n`);
  const path = (u: string) => {
    try {
      const x = new URL(u);
      return x.pathname + x.search || "/";
    } catch {
      return u;
    }
  };

  h(2, "4. SEO tab");
  p(
    `Site: ${seo.siteUrl ?? "not configured"} · Search Console: ${seo.config.searchConsole ? "connected" : "not connected"} · Bing backlinks: ${seo.config.bing ? "configured" : "not configured"}`
  );

  // ---- site audit ----
  h(3, "Site audit (own crawler)");
  const c = seo.crawl;
  if (!c) {
    p("_No site audit has been run yet._");
  } else {
    const count = (sev: string) =>
      c.issues.filter((i) => i.severity === sev).reduce((n, i) => n + i.urls.length, 0);
    p(
      [
        `- Crawled: ${c.finishedAt} (${c.durationSeconds}s), ${c.pagesCrawled} pages${c.truncated ? " (hit the page limit — site is larger)" : ""}`,
        `- Health score: ${c.score}/100 · page-level errors: ${count("error")}, warnings: ${count("warning")}, notices: ${count("notice")}`,
        `- robots.txt: ${c.robots.found ? "found" : "missing"}${c.robots.blocksEverything ? " (BLOCKS ALL CRAWLERS)" : ""} · sitemap URLs: ${c.sitemapUrlCount}`,
      ].join("\n")
    );
    h(4, "Issues (with up to 15 affected URLs each)");
    for (const i of c.issues) {
      p(
        `**[${i.severity.toUpperCase()}] ${i.label}** — ${i.urls.length} page(s). ${i.description}\n` +
          i.urls.slice(0, 15).map((u) => `  - ${path(u)}`).join("\n") +
          (i.urls.length > 15 ? `\n  - …and ${i.urls.length - 15} more` : "")
      );
    }
    h(4, "Broken links");
    p(
      table(
        ["Found on", "Links to", "Status", "Anchor", "Type"],
        c.brokenLinks.map((b) => [path(b.from), b.external ? b.to : path(b.to), b.status || "no response", b.anchor, b.external ? "external" : "internal"])
      )
    );
    h(4, "All crawled pages");
    p(
      table(
        ["URL", "Status", "Indexable", "Title", "Title len", "Meta len", "H1s", "Words", "Inlinks", "Depth", "ms", "In sitemap", "Issues"],
        c.pages.map((pg) => [
          path(pg.url), pg.status || "fail", pg.indexable ? "yes" : "no", pg.title, pg.titleLength, pg.metaLength,
          pg.h1.length, pg.wordCount, pg.inlinks, pg.depth, pg.responseMs, pg.inSitemap ? "yes" : "no", pg.issues.join(", "),
        ])
      )
    );
  }

  // ---- search opportunities ----
  const o = seo.opportunities;
  h(3, "Keyword opportunities (from Search Console)");
  if (!o.configured) p("_Search Console not connected._");
  else if (o.error) p(`_Error: ${o.error}_`);
  else {
    p(
      [
        `- Window: ${o.window?.startDate} to ${o.window?.endDate} (previous: ${o.previousWindow?.startDate} to ${o.previousWindow?.endDate})`,
        `- Distinct queries: ${o.totalQueries} · branded clicks ${o.brand.brandedClicks} vs non-branded ${o.brand.nonBrandedClicks} (brand terms: ${o.brand.terms.join(", ")})`,
      ].join("\n")
    );
    const qrows = (rows: { query: string; clicks: number; impressions: number; ctr: number; position: number }[]) =>
      rows.map((r) => [r.query, r.clicks, r.impressions, pct(r.ctr, 2), r.position.toFixed(1)]);
    const qh = ["Query", "Clicks", "Impr.", "CTR", "Pos."];
    h(4, "Striking distance (position 8–20)");
    p(table([...qh, "Est. extra clicks", "Page"], o.strikingDistance.map((r) => [...qrows([r])[0], r.estimatedExtraClicks, r.page ? path(r.page) : ""])));
    h(4, "Low CTR for their position");
    p(table([...qh, "Missed clicks", "Page"], o.lowCtr.map((r) => [...qrows([r])[0], r.estimatedExtraClicks, r.page ? path(r.page) : ""])));
    h(4, "Rising queries");
    p(table(["Query", "Clicks", "Prev clicks", "Δ clicks", "Pos.", "Δ pos."], o.rising.map((r) => [r.query, r.clicks, r.prevClicks, r.deltaClicks, r.position.toFixed(1), r.deltaPosition ?? ""])));
    h(4, "Falling queries");
    p(table(["Query", "Clicks", "Prev clicks", "Δ clicks", "Pos.", "Δ pos."], o.falling.map((r) => [r.query, r.clicks, r.prevClicks, r.deltaClicks, r.position.toFixed(1), r.deltaPosition ?? ""])));
    h(4, "New queries");
    p(table(qh, qrows(o.newQueries)));
    h(4, "Lost queries");
    p(table(qh, qrows(o.lostQueries)));
    h(4, "Cannibalization (multiple pages for one query)");
    p(table(["Query", "Impressions", "Pages (clicks/impr/pos)"], o.cannibalization.map((r) => [r.query, r.totalImpressions, r.pages.map((x) => `${path(x.page)} (${x.clicks}/${x.impressions}/${x.position.toFixed(1)})`).join("; ")])));
    h(4, "Decaying pages");
    p(table(["Page", "Clicks", "Prev", "Change"], o.decayingPages.map((r) => [path(r.page), r.clicks, r.prevClicks, pct(r.deltaPct, 0)])));
    h(4, "Growing pages");
    p(table(["Page", "Clicks", "Prev", "Change"], o.growingPages.map((r) => [path(r.page), r.clicks, r.prevClicks, pct(r.deltaPct, 0)])));
    h(4, "Rank tracker — weekly average position, oldest → newest (top 30 queries)");
    p(table(["Query", "Pos. now", "Clicks (90d)", "Impr. (90d)", "Weekly positions"], o.rankTrends.map((r) => [r.query, r.currentPosition, r.clicks, r.impressions, r.weeks.map((w) => w.position).join(" → ")])));
  }

  // ---- indexing ----
  h(3, "Indexing (Google URL Inspection)");
  p(
    table(
      ["URL", "Verdict", "Coverage", "Last crawled", "Google canonical matches yours", "Error"],
      seo.inspections.map((i) => [
        path(i.url), i.verdict, i.coverageState, i.lastCrawlTime?.slice(0, 10),
        i.googleCanonical && i.userCanonical ? (i.googleCanonical === i.userCanonical ? "yes" : `NO (google: ${i.googleCanonical})`) : "", i.error,
      ])
    )
  );

  // ---- speed ----
  h(3, "Speed / Core Web Vitals (PageSpeed Insights)");
  p(
    table(
      ["URL", "Device", "Perf", "SEO", "A11y", "Best pr.", "LCP s", "CLS", "TBT ms", "Real-user", "Top fixes"],
      seo.pagespeed.map((r) => [
        path(r.url), r.strategy, r.performance, r.seo, r.accessibility, r.bestPractices,
        r.lcpMs === null ? "" : (r.lcpMs / 1000).toFixed(1), r.cls === null ? "" : r.cls.toFixed(3),
        r.tbtMs === null ? "" : Math.round(r.tbtMs), r.fieldCategory, r.opportunities.map((x) => x.title).join("; ") || r.error,
      ])
    )
  );

  // ---- backlinks ----
  h(3, "Backlinks (Bing Webmaster — a partial index, treat as a floor)");
  const b = seo.backlinks;
  if (!b.configured) p("_Bing Webmaster API key not configured._");
  else if (!b.fetchedAt) p("_Not fetched yet._");
  else {
    p(`- Fetched ${b.fetchedAt} · total inbound links: ${b.totalLinks} · linked pages: ${b.targets.length}`);
    p(table(["Page", "Links"], b.targets.slice(0, 30).map((t) => [path(t.url), t.count])));
    p(table(["Referring domain (sample)", "Links"], b.referringDomains.map((d) => [d.domain, d.links])));
    p(table(["Linking page", "Anchor", "Points to"], b.samples.slice(0, 60).map((s) => [s.source, s.anchor, path(s.target)])));
  }

  // ---- Phase 4 additions ----
  const cr = seo.crawl;
  if (cr?.security) {
    h(3, "Security & HTTPS (read from " + cr.security.checkedUrl + ")");
    p(`- HTTPS: ${cr.security.https ? "yes" : "NO"} · http:// redirects to https://: ${cr.security.httpRedirectsToHttps === null ? "unknown" : cr.security.httpRedirectsToHttps ? "yes" : "NO"}`);
    p(table(["Header", "Present", "Value / advice"], cr.security.headers.map((x) => [x.label, x.present ? "yes" : "NO", x.present ? x.value : x.advice])));
  }
  if (cr?.imageStats) p(`Images measured: ${cr.imageStats.checked}, ${cr.imageStats.heavy} over ${Math.round(cr.imageStats.limitBytes / 1000)} KB, ${(cr.imageStats.totalBytes / 1e6).toFixed(1)} MB total.`);
  const schemaPages = (cr?.pages ?? []).filter((x) => x.schemaTypes?.length || x.schemaProblems?.length);
  if (schemaPages.length) {
    h(3, "Structured data (JSON-LD) found");
    p(table(["Page", "Types", "Problems"], schemaPages.map((x) => [path(x.url), (x.schemaTypes ?? []).join(", "), (x.schemaProblems ?? []).join("; ")])));
  }
  const audits = seo.history?.audits ?? [];
  if (audits.length) {
    h(3, "Audit history");
    p(table(["Date", "Score", "Errors", "Warnings", "Notices", "Pages"], audits.map((a) => [a.at.slice(0, 10), a.score, a.errors, a.warnings, a.notices, a.pages])));
    if (audits.length >= 2) {
      const d = diffAudits(audits[audits.length - 2], audits[audits.length - 1]);
      h(4, `Changes since previous audit (${d.prevAt.slice(0, 10)} → ${d.at.slice(0, 10)})`);
      p(`Score ${d.scoreDelta >= 0 ? "+" : ""}${d.scoreDelta}; ${d.newCount} newly affected URLs; ${d.fixedCount} fixed.`);
      p(table(["Issue", "Before", "Now", "New URLs", "Fixed URLs"], d.issues.map((i) => [i.code, i.prevCount, i.count, (i.newUrls ?? []).slice(0, 6).map(path).join(", "), (i.fixedUrls ?? []).slice(0, 6).map(path).join(", ")])));
    }
  }
  const cwv = seo.history?.cwv ?? [];
  if (cwv.length) {
    h(3, "Core Web Vitals history");
    const combos = new Map<string, { url: string; strategy: "mobile" | "desktop" }>();
    for (const x of cwv) combos.set(`${x.strategy}|${x.url}`, { url: x.url, strategy: x.strategy });
    for (const { url, strategy } of combos.values()) {
      h(4, `${strategy} · ${path(url)}`);
      p(table(["Date", "Perf", "SEO", "A11y", "LCP s", "TBT ms", "CLS×100", "Field LCP s"], cwvSeries(cwv, url, strategy).map((r) => [r.day, r.performance, r.seo, r.accessibility, r.lcpS, r.tbtMs, r.clsX100, r.fieldLcpS])));
    }
  }
  const bl = seo.history?.backlinks ?? [];
  if (bl.length >= 2) {
    const d = diffBacklinks(bl[bl.length - 2], bl[bl.length - 1]);
    h(3, `Backlink changes (${d.prevAt.slice(0, 10)} → ${d.at.slice(0, 10)})`);
    p(`Total ${d.totalDelta >= 0 ? "+" : ""}${d.totalDelta}. New domains: ${d.newDomains.join(", ") || "none"}. Lost domains: ${d.lostDomains.join(", ") || "none"}.`);
    if (d.linksComparable) p(table(["Change", "Linking page", "Points to"], [...d.newLinks.map((l) => ["new", l.source, path(l.target)]), ...d.lostLinks.map((l) => ["LOST", l.source, path(l.target)])]));
  } else if (bl.length === 1) p(`Backlink snapshots: 1 (${bl[0].at.slice(0, 10)}) — changes appear after the next refresh.`);
  const il = internalLinkSuggestions(seo.crawl, seo.opportunities, seo.opportunities.brand.terms);
  h(3, "Internal link suggestions (pages with impressions but few internal links)");
  if (il.items.length === 0) p(`_${il.reason ?? "None."}_`);
  else p(table(["Target page", "Impressions", "Internal links", "Top query", "Link from"], il.items.map((s) => [path(s.target), s.impressions, s.inlinks, s.topQuery, s.sources.map((x) => path(x.url)).join(", ")])));

  return out.join("\n");
}

// Rough token estimate (~4 chars per token) for the UI hint.
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);


// ---------- Operations (uptime, SSL, domains, alerts) ----------

function opsJson(o: MonitorStatus, pii: boolean) {
  return {
    configured: o.configured,
    lastRunAt: o.lastRunAt,
    durableStorage: o.durable,
    channels: o.channels,
    thresholds: o.thresholds,
    targets: o.targets.map((t) => ({ url: t.url, up: t.last?.ok ?? null, lastStatus: t.last?.status ?? null, lastDetail: t.last?.detail ?? null, uptime24h: t.uptime24h, uptime7d: t.uptime7d, uptime30d: t.uptime30d, avgLatencyMs24h: t.avgLatency24h, checks24h: t.checks24h })),
    ssl: o.certs,
    domains: o.domains,
    // Alert text can name subscribers, so it follows the personal-data toggle.
    recentNotifications: o.notifications.slice(0, 30).map((n) => ({ at: n.at, kind: n.kind, severity: n.severity, channels: n.channels, error: n.error, ...(pii ? { title: n.title, body: n.body } : {}) })),
  };
}

export function buildOpsMarkdown(o: MonitorStatus, pii: boolean): string {
  const out: string[] = ["", "## 8. Operations (uptime, SSL, domains, alerts)", ""];
  const pc = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(2)}%`);
  if (!o.configured) return [...out, "_No URLs configured (MONITOR_URLS / SEO_SITE_URL)._", ""].join("\n");
  out.push(`Last check: ${o.lastRunAt ?? "never"} · alert channels: Slack ${o.channels.slack ? "on" : "off"}, email ${o.channels.email ? "on" : "off"} · history storage: ${o.durable ? "Supabase" : "local file"}`, "");
  out.push(table(["URL", "Status", "Uptime 24h", "7d", "30d", "Avg ms (24h)", "Checks 24h"], o.targets.map((t) => [t.url, t.last ? (t.last.ok ? "UP" : `DOWN (${t.last.detail ?? t.last.status})`) : "no data", pc(t.uptime24h), pc(t.uptime7d), pc(t.uptime30d), t.avgLatency24h ?? "n/a", t.checks24h])), "");
  out.push(`### SSL certificates (alert at ${o.thresholds.sslDays} days)`, "");
  out.push(table(["Host", "Days left", "Expires", "Issuer", "Trusted"], o.certs.map((c) => [c.host, c.daysLeft ?? "unknown", c.validTo?.slice(0, 10) ?? "", c.issuer ?? "", c.authorized ? "yes" : c.error ?? "no"])), "");
  out.push(`### Domain renewals (alert at ${o.thresholds.domainDays} days)`, "");
  out.push(table(["Domain", "Days left", "Expires", "Registrar", "Source", "Note"], o.domains.map((d) => [d.domain, d.daysLeft ?? "unknown", d.expires?.slice(0, 10) ?? "", d.registrar ?? "", d.source ?? "", d.error ?? ""])), "");
  out.push("### Recent alerts and digests", "");
  out.push(table(["When (UTC)", "Type", "Severity", "Delivered", ...(pii ? ["Message"] : [])], o.notifications.slice(0, 30).map((n) => [n.at.slice(0, 16).replace("T", " "), n.kind, n.severity, n.error ?? n.channels.join("+"), ...(pii ? [n.title] : [])])), "");
  return out.join("\n");
}
