// Drop this into your NorthBooks app (e.g. lib/analytics.ts).
// Sends the four conversion events to GA4 WITHOUT any personal information.
//
//   signup_completed        – browser, once, right after the account is created
//   company_created         – browser, after a company is saved
//   first_invoice_created   – browser (once per user) or server; see docs/ga4-events.md
//   subscription_activated  – SERVER ONLY, after Helcim confirms the payment

type Params = Record<string, string | number | boolean | undefined>;

// Never let these through, whatever a caller passes.
const BLOCKED_KEY = /e-?mail|name|phone|address|postal|zip|(^|_)sin($|_)|token|password|card|company|client|user_?id|uid/i;
const LOOKS_LIKE_EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Drops anything that could identify a person. Keep params to plan names, amounts, booleans. */
export function sanitizeParams(params: Params = {}): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || BLOCKED_KEY.test(k)) continue;
    if (typeof v === "string" && (LOOKS_LIKE_EMAIL.test(v) || v.length > 100)) continue;
    out[k] = v;
  }
  return out;
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/** Browser-side event. No-ops if GA4 isn't loaded (ad blocker, no consent). */
export function track(event: string, params?: Params): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", event, sanitizeParams(params));
}

/** Fire an event only once per browser (guards against refreshes and re-renders). */
export function trackOnce(event: string, key: string, params?: Params): void {
  if (typeof window === "undefined") return;
  const k = `ga_once_${event}_${key}`;
  try {
    if (localStorage.getItem(k)) return;
    localStorage.setItem(k, "1");
  } catch {
    /* storage blocked: fall through and send */
  }
  track(event, params);
}

// ---------- Server side (Measurement Protocol) ----------
// Use for subscription_activated (and optionally first_invoice_created).
// Needs GA4_MEASUREMENT_ID and GA4_API_SECRET (GA4 Admin → Data streams →
// your stream → Measurement Protocol API secrets).

export async function trackServer(opts: {
  event: string;
  clientId: string; // the browser's GA client id (the "_ga" cookie), saved at signup — NOT an email or user id
  sessionId?: string; // optional: keeps the conversion in the original session/source
  params?: Params;
}): Promise<{ ok: boolean; status: number }> {
  const id = process.env.GA4_MEASUREMENT_ID;
  const secret = process.env.GA4_API_SECRET;
  if (!id || !secret) return { ok: false, status: 0 };
  const params: Params = { ...sanitizeParams(opts.params) };
  if (opts.sessionId) params.session_id = opts.sessionId;
  params.engagement_time_msec = 1; // required for the event to count in some reports
  const res = await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${id}&api_secret=${secret}`, {
    method: "POST",
    body: JSON.stringify({ client_id: opts.clientId, events: [{ name: opts.event, params }] }),
  });
  return { ok: res.ok, status: res.status };
}

/** Read the GA client id from the browser's _ga cookie ("GA1.1.123456789.1700000000" → "123456789.1700000000"). */
export function readGaClientId(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)_ga=GA\d\.\d\.([^;]+)/);
  return m ? m[1] : null;
}
