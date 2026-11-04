// Validates the four conversion events against GA4's Measurement Protocol
// *debug* endpoint. Nothing is recorded in your reports.
//
//   GA4_MEASUREMENT_ID=G-XXXXXXX GA4_API_SECRET=xxxx node docs/ga4/test-event.mjs
//
// Every event should come back with an empty "validationMessages" list.

const id = process.env.GA4_MEASUREMENT_ID;
const secret = process.env.GA4_API_SECRET;
if (!id || !secret) {
  console.error("Set GA4_MEASUREMENT_ID and GA4_API_SECRET first.");
  process.exit(1);
}

const events = [
  { name: "signup_completed", params: { method: "email" } },
  { name: "company_created", params: { province: "ON" } },
  { name: "first_invoice_created", params: { value: 1 } },
  { name: "subscription_activated", params: { plan: "pro", billing_period: "monthly", value: 9, currency: "CAD", transaction_id: "test-sub-1" } },
];

let failed = false;
for (const e of events) {
  const res = await fetch(`https://www.google-analytics.com/debug/mp/collect?measurement_id=${id}&api_secret=${secret}`, {
    method: "POST",
    body: JSON.stringify({ client_id: "test.1234567890", events: [{ name: e.name, params: { ...e.params, engagement_time_msec: 1 } }] }),
  });
  const json = await res.json().catch(() => ({}));
  const msgs = json.validationMessages ?? [];
  console.log(`${msgs.length === 0 && res.ok ? "PASS" : "FAIL"}  ${e.name}${msgs.length ? "\n      " + JSON.stringify(msgs) : ""}`);
  if (msgs.length || !res.ok) failed = true;
}
process.exit(failed ? 1 : 0);
