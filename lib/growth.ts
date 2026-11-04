// Pure, client-safe growth maths: funnel, campaign ROI, post results.
import type { Metrics, SubscriberRow } from "./metrics";
import type { Post } from "./adminTypes";

const DAY = 86_400_000;

export type FunnelStep = { label: string; count: number | null; ofPrev: number | null; ofFirst: number | null; note?: string };

/** Signup cohort funnel. `windowDays` null = all time. Visitors only apply to the GA4 30-day window. */
export function buildFunnel(
  rows: SubscriberRow[],
  windowDays: number | null,
  visitors: number | null
): FunnelStep[] {
  const cutoff = windowDays ? Date.now() - windowDays * DAY : 0;
  const cohort = rows.filter((r) => new Date(r.joinedAt).getTime() >= cutoff);
  const counts: [string, number | null, string?][] = [
    ["Visitors (GA4)", windowDays === 30 ? visitors : null, windowDays === 30 ? "GA4 users, last 30 days" : "GA4 only covers 30 days"],
    ["Signed up", cohort.length],
    ["Created a company", cohort.filter((r) => r.companyCount > 0).length],
    ["Made a product or project", cohort.filter((r) => r.productCount + r.projectCount > 0).length],
    ...(rows.some((r) => r.usage) ? [["Activated (invoice, expense or bank statement)", cohort.filter((r) => r.activated).length] as [string, number]] : []),
    ["Paid", cohort.filter((r) => r.isPaid).length],
  ];
  const steps: FunnelStep[] = [];
  let prev: number | null = null;
  let first: number | null = null;
  for (const [label, count, note] of counts) {
    if (count === null) { steps.push({ label, count: null, ofPrev: null, ofFirst: null, note }); continue; }
    if (first === null) first = count;
    steps.push({
      label, count, note,
      ofPrev: prev !== null && prev > 0 ? count / prev : null,
      ofFirst: first > 0 ? count / first : null,
    });
    prev = count;
  }
  return steps;
}

export type CampaignDim = "signupCampaign" | "signupContent" | "signupSource" | "leadSource";
export const CAMPAIGN_DIMS: { id: CampaignDim; label: string }[] = [
  { id: "signupCampaign", label: "utm_campaign" },
  { id: "signupContent", label: "utm_content" },
  { id: "signupSource", label: "utm_source" },
  { id: "leadSource", label: "Lead source" },
];

export type CampaignRow = {
  key: string;
  signups: number;
  setUp: number;
  building: number;
  activated: number;
  loggedIn: number;
  paid: number;
  mrr: number;
  setUpRate: number;
  buildingRate: number;
  activatedRate: number;
  paidRate: number;
  firstSignup: string;
  lastSignup: string;
};

const NONE = "(none)";

export function mrrOf(r: SubscriberRow, planPricing: Record<string, number>): number {
  if (r.helcimMonthly !== null && (r.helcimStatus === "active" || r.helcimStatus === "term_ending")) return r.helcimMonthly;
  if (!r.isPaid) return 0;
  return planPricing[(r.plan ?? "").toLowerCase()] ?? 0;
}

export function campaignTable(rows: SubscriberRow[], dim: CampaignDim, planPricing: Record<string, number>): CampaignRow[] {
  const map = new Map<string, CampaignRow>();
  for (const r of rows) {
    let key = (r[dim] ?? "").toString().trim().toLowerCase();
    if (!key || key === "not captured") key = NONE;
    const c = map.get(key) ?? { key, signups: 0, setUp: 0, building: 0, activated: 0, loggedIn: 0, paid: 0, mrr: 0, setUpRate: 0, buildingRate: 0, activatedRate: 0, paidRate: 0, firstSignup: r.joinedAt, lastSignup: r.joinedAt };
    c.signups++;
    if (r.activationStage !== "not_started") c.setUp++;
    if (r.activationStage === "building") c.building++;
    if (r.activated) c.activated++;
    if (r.lastLoginAt) c.loggedIn++;
    if (r.isPaid) c.paid++;
    c.mrr += mrrOf(r, planPricing);
    if (r.joinedAt < c.firstSignup) c.firstSignup = r.joinedAt;
    if (r.joinedAt > c.lastSignup) c.lastSignup = r.joinedAt;
    map.set(key, c);
  }
  return [...map.values()].map((c) => ({
    ...c,
    mrr: Math.round(c.mrr * 100) / 100,
    setUpRate: c.setUp / c.signups,
    buildingRate: c.building / c.signups,
    activatedRate: c.activated / c.signups,
    paidRate: c.paid / c.signups,
    firstSignup: c.firstSignup.slice(0, 10),
    lastSignup: c.lastSignup.slice(0, 10),
  }));
}

export type PostResult = Post & { signups: number; signups7d: number; setUp: number; paid: number; mrr: number; matchedBy: string };

/** Attribute signups to a logged post by utm_campaign (+ utm_content if the post has one). */
export function postResults(posts: Post[], rows: SubscriberRow[], planPricing: Record<string, number>): PostResult[] {
  const eq = (a: string | null, b: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
  return posts.map((p) => {
    let matched: SubscriberRow[] = [];
    let matchedBy = "no UTM on post";
    if (p.utmCampaign) {
      matched = rows.filter((r) => eq(r.signupCampaign, p.utmCampaign) && (!p.utmContent || eq(r.signupContent, p.utmContent)));
      matchedBy = p.utmContent ? "campaign + content" : "campaign";
    }
    const start = new Date(p.postedOn).getTime();
    const mk = (r: SubscriberRow) => new Date(r.joinedAt).getTime();
    return {
      ...p,
      signups: matched.length,
      signups7d: matched.filter((r) => mk(r) >= start && mk(r) < start + 7 * DAY).length,
      setUp: matched.filter((r) => r.activationStage !== "not_started").length,
      paid: matched.filter((r) => r.isPaid).length,
      mrr: Math.round(matched.reduce((n, r) => n + mrrOf(r, planPricing), 0) * 100) / 100,
      matchedBy,
    };
  });
}

// ---------- UTM links ----------

export const slug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export function buildUtmUrl(base: string, p: { source: string; medium: string; campaign: string; content?: string; term?: string }): string | null {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(base) ? base : `https://${base}`); } catch { return null; }
  const set = (k: string, v?: string) => { if (v && slug(v)) u.searchParams.set(k, slug(v)); };
  set("utm_source", p.source); set("utm_medium", p.medium); set("utm_campaign", p.campaign);
  set("utm_content", p.content); set("utm_term", p.term);
  return u.toString();
}

export function growthSummary(m: Metrics) { // for the export
  return {
    funnel30: buildFunnel(m.subscriberList, 30, null),
    funnelAll: buildFunnel(m.subscriberList, null, null),
  };
}
