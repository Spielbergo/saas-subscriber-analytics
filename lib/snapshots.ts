import "server-only";
import { getMetrics, type Metrics } from "./metrics";
import { getMarketingMetrics, type MarketingMetrics } from "./marketing";
import { readCache, writeCache } from "./seo/store";
import { sb, tryTable } from "./adminStore";
import { todayLocal } from "./dates";
import type { Snapshot, SnapshotData, Annotation } from "./adminTypes";

const FILE = "snapshots.json";
const ANN_FILE = "annotations.json";

export function buildSnapshot(m: Metrics, mk?: MarketingMetrics | null): SnapshotData {
  const useHelcim = m.mrrActual !== null;
  const subscribers = m.subscriberList
    .filter((r) => r.isPaid || (r.helcimMonthly ?? 0) > 0)
    .map((r) => ({
      id: r.id,
      plan: r.plan,
      status: r.status,
      mrr: useHelcim
        ? r.helcimStatus === "active" || r.helcimStatus === "term_ending"
          ? r.helcimMonthly ?? 0
          : 0
        : m.planPricing[(r.plan ?? "").toLowerCase()] ?? 0,
    }));
  const ga = mk?.ga4?.configured ? mk.ga4 : null;
  const sc = mk?.searchConsole?.configured ? mk.searchConsole : null;
  return {
    users: m.totalUsers,
    paid: m.paidSubscribers,
    free: m.freeUsers,
    mrr: m.mrrActual ?? m.mrr,
    mrrSource: useHelcim ? "helcim" : "estimate",
    estimatedMrr: m.mrr,
    byPlan: m.subscribers.byPlan,
    byStatus: m.subscribers.byStatus,
    signups7: m.signups.last7Days,
    signups30: m.signups.last30Days,
    cancellations30: m.cancellations.last30Days,
    atRisk: m.atRiskCount,
    inactiveFree: m.inactiveFreeCount,
    notStarted: m.activationCounts.not_started,
    setUp: m.activationCounts.set_up,
    building: m.activationCounts.building + m.activationCounts.activated,
    activated: m.usageAvailable ? m.activationCounts.activated : null,
    companies: m.totalCompanies,
    products: m.productTotals.products,
    projects: m.productTotals.projects,
    neverLoggedIn: m.neverLoggedInCount,
    overdueRenewals: m.overdueRenewals.length,
    trialConversionRate: m.trialConversion.rate,
    helcim: m.helcim.configured && !m.helcim.error
      ? { active: m.helcim.activeCount, failed: m.helcim.failedPaymentCount, paused: m.helcim.pausedCount, mrr: m.helcim.mrr }
      : null,
    ga: ga ? { sessions: ga.sessions, users: ga.totalUsers, newUsers: ga.newUsers, keyEvents: ga.conversions, engagementRate: ga.engagementRate } : null,
    sc: sc ? { clicks: sc.clicks, impressions: sc.impressions, ctr: sc.ctr, position: sc.position } : null,
    seo: null,
    backlinks: null,
    subscribers,
  };
}

export async function listSnapshots(limit = 400): Promise<{ snapshots: Snapshot[]; durable: boolean }> {
  const r = await tryTable("admin_snapshots", () =>
    sb().from("admin_snapshots").select("day,data").order("day", { ascending: true }).limit(limit)
  );
  if (r.ok) return { snapshots: (r.data ?? []) as Snapshot[], durable: true };
  return { snapshots: readCache<Snapshot[]>(FILE, []).slice(-limit), durable: false };
}

async function saveSnapshot(s: Snapshot): Promise<boolean> {
  const r = await tryTable("admin_snapshots", () =>
    sb().from("admin_snapshots").upsert({ day: s.day, data: s.data }).select("day")
  );
  if (r.ok) return true;
  const all = readCache<Snapshot[]>(FILE, []).filter((x) => x.day !== s.day);
  all.push(s);
  all.sort((a, b) => a.day.localeCompare(b.day));
  writeCache(FILE, all);
  return false;
}

const g = globalThis as unknown as { __snapAt?: number };

/** Capture today's snapshot. Skips if one was taken in the last 3 hours unless forced. */
export async function captureSnapshot(force = false): Promise<{ day: string; skipped: boolean; durable: boolean }> {
  const day = todayLocal();
  if (!force && g.__snapAt && Date.now() - g.__snapAt < 3 * 3600_000) {
    return { day, skipped: true, durable: true };
  }
  const [metrics, marketing] = await Promise.all([getMetrics(), getMarketingMetrics().catch(() => null)]);
  const durable = await saveSnapshot({ day, data: buildSnapshot(metrics, marketing) });
  g.__snapAt = Date.now();
  return { day, skipped: false, durable };
}

// ---------- annotations ----------

export async function listAnnotations(): Promise<Annotation[]> {
  const r = await tryTable("admin_annotations", () =>
    sb().from("admin_annotations").select("id,day,label").order("day", { ascending: true })
  );
  if (r.ok) return ((r.data ?? []) as { id: number | string; day: string; label: string }[]).map((a) => ({ ...a, id: String(a.id) }));
  return readCache<Annotation[]>(ANN_FILE, []);
}

export async function addAnnotation(day: string, label: string): Promise<void> {
  const r = await tryTable("admin_annotations", () =>
    sb().from("admin_annotations").insert({ day, label }).select("id")
  );
  if (r.ok) return;
  const all = readCache<Annotation[]>(ANN_FILE, []);
  all.push({ id: `${Date.now()}`, day, label });
  writeCache(ANN_FILE, all);
}

export async function deleteAnnotation(id: string): Promise<void> {
  const r = await tryTable("admin_annotations", () =>
    sb().from("admin_annotations").delete().eq("id", id).select("id")
  );
  if (r.ok) return;
  writeCache(ANN_FILE, readCache<Annotation[]>(ANN_FILE, []).filter((a) => a.id !== id));
}
