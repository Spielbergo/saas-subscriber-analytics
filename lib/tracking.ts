import type { EventTruth } from "./metrics";

// Client-safe definitions for the GA4 conversion events and how the
// dashboard verifies them against the real data.

export const TRACKED_EVENTS = [
  { name: "signup_completed", label: "Signed up", backend: "Profiles created", where: "client, after the account is created" },
  { name: "company_created", label: "Company created", backend: "Companies created", where: "client or server, when the first company is saved" },
  { name: "first_invoice_created", label: "First invoice created", backend: "Users whose first invoice was created", where: "server — fire once, when a user's invoice count goes 0 → 1" },
  { name: "subscription_activated", label: "Subscription activated", backend: "Helcim subscriptions activated", where: "server (Measurement Protocol) — only after Helcim confirms the payment" },
] as const;

export type TrackedEventName = (typeof TRACKED_EVENTS)[number]["name"];

export type TrackingRow = {
  event: TrackedEventName;
  label: string;
  ga4: number | null; // null = GA4 not connected
  backend: number | null; // null = couldn't be measured
  backendLabel: string;
  ratio: number | null; // ga4 / backend
  status: "ok" | "not_firing" | "undercount" | "overcount" | "no_data" | "unknown";
  note: string;
};

/**
 * Compare a GA4 count with the truth from your own data.
 * Browser events lose some hits to ad blockers/consent, so a modest
 * undercount is normal; server-side events (Measurement Protocol) should
 * match almost exactly.
 */
export function compareEvent(
  ga4: number | null,
  backend: number | null,
  serverSide: boolean
): { status: TrackingRow["status"]; ratio: number | null; note: string } {
  if (ga4 === null) return { status: "unknown", ratio: null, note: "GA4 isn't connected." };
  if (backend === null) return { status: "unknown", ratio: null, note: "Can't measure the real count yet." };
  if (backend === 0 && ga4 === 0) return { status: "no_data", ratio: null, note: "Nothing happened in this window." };
  if (ga4 === 0) return { status: "not_firing", ratio: 0, note: `Happened ${backend}× in your data but GA4 recorded none — the event isn't being sent (or the name differs).` };
  if (backend === 0) return { status: "overcount", ratio: null, note: "GA4 recorded events but your data shows none — check for test traffic or a wrong trigger." };
  const ratio = ga4 / backend;
  const low = serverSide ? 0.9 : 0.7;
  const high = serverSide ? 1.1 : 1.15;
  if (ratio < low) return { status: "undercount", ratio, note: serverSide ? "A server-side event should match closely — some are failing to send." : "More than ~30% missing: more than ad blockers/consent would explain." };
  if (ratio > high) return { status: "overcount", ratio, note: "GA4 has more than really happened — likely firing twice (refresh, retry) or on test accounts. Send a transaction_id/once-only guard." };
  return { status: "ok", ratio, note: "Matches your data." };
}

const SERVER_SIDE: Record<TrackedEventName, boolean> = {
  signup_completed: false,
  company_created: false,
  first_invoice_created: true,
  subscription_activated: true,
};

/** One row per conversion event: GA4's count vs. what your own data says. */
export function buildTrackingRows(
  truth: EventTruth,
  ga4: { configured: boolean; trackedEvents: { event: string; count: number }[] } | null
): TrackingRow[] {
  const backend: Record<TrackedEventName, number | null> = {
    signup_completed: truth.signups30,
    company_created: truth.companies30,
    first_invoice_created: truth.firstInvoices30,
    subscription_activated: truth.activations30,
  };
  return TRACKED_EVENTS.map((e) => {
    const g = ga4?.configured ? ga4.trackedEvents.find((x) => x.event === e.name)?.count ?? 0 : null;
    const cmp = compareEvent(g, backend[e.name], SERVER_SIDE[e.name]);
    const label = e.name === "subscription_activated" && truth.activationsSource === "supabase" ? "Paid subscriptions created (Supabase)" : e.backend;
    return { event: e.name, label: e.label, ga4: g, backend: backend[e.name], backendLabel: label, ...cmp };
  });
}
