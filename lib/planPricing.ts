/**
 * user_subscriptions.plan is just a text label — there's no price column
 * in the database. Map each plan name to its monthly price here so the
 * dashboard can estimate MRR.
 *
 * Defaults below are the confirmed prices (Pro $9, Pro Plus $15). To change
 * them without touching code, set
 * PLAN_PRICES in .env.local as JSON, e.g.
 *   PLAN_PRICES={"free":0,"pro":9,"pro plus":19}
 * Env values override the defaults below. Keys are matched lowercased
 * against user_subscriptions.plan.
 */
const DEFAULT_PRICING: Record<string, number> = {
  free: 0,
  pro: 9,
  "pro plus": 15,
};

function loadPricing(): { pricing: Record<string, number>; fromEnv: boolean } {
  const raw = process.env.PLAN_PRICES;
  if (!raw) return { pricing: DEFAULT_PRICING, fromEnv: true };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pricing: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        pricing[k.toLowerCase()] = v;
      }
    }
    return { pricing, fromEnv: true };
  } catch {
    return { pricing: DEFAULT_PRICING, fromEnv: false };
  }
}

const loaded = loadPricing();
export const PLAN_PRICING: Record<string, number> = loaded.pricing;
// false only if PLAN_PRICES is set but unparseable (falls back to defaults).
export const PRICING_FROM_ENV = loaded.fromEnv;

export function isFreePlan(plan: string | null | undefined): boolean {
  return !plan || plan.toLowerCase() === "free" || priceForPlan(plan) === 0;
}

export function priceForPlan(plan: string): number {
  return PLAN_PRICING[plan.toLowerCase()] ?? 0;
}
