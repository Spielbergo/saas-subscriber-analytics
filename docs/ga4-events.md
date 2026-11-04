# GA4 conversion events for NorthBooks

The dashboard's **Growth → Tracking check** compares what GA4 recorded with what really happened (Supabase + Helcim). This file is what to add to the **main NorthBooks app** so the events exist. The dashboard itself can't send them — it only reads.

## The four events

| Event | Fire when | Where | Params (no personal data) |
|---|---|---|---|
| `signup_completed` | The account has just been created | Browser, once | `method` (email/google) |
| `company_created` | A company is saved for the first time | Browser | `province` (optional) |
| `first_invoice_created` | A user's invoice count goes 0 → 1 | Browser once-per-user, or server | `value` (optional) |
| `subscription_activated` | **Helcim confirms** the first successful payment | **Server only** | `plan`, `billing_period`, `value`, `currency`, `transaction_id` (Helcim subscription id) |

"Meaningful activation" in the dashboard = the user created an invoice, tracked an expense, or uploaded a bank statement (`first_invoice_created` is the clearest signal; add `expense_created` / `bank_statement_uploaded` events the same way if you want them in GA4 too).

## Privacy rules (don't skip)

- Never send email, name, phone, company name, client names, addresses or invoice contents to GA4 — not as params, not in page URLs, not as `user_id`.
- Don't put emails in URLs or query strings (e.g. `/verify?email=…`). The dashboard's tracking check flags this if it happens.
- `sanitizeParams()` in `analytics.ts` strips risky keys and anything that looks like an email, as a safety net.
- Don't set GA4 `user_id` unless you have a reason; a random UUID is the most you should ever send. Cross-device user tracking needs consent (PIPEDA / Quebec Law 25).
- Respect your cookie-consent choice: `track()` simply does nothing if GA4 isn't loaded.

## Wiring it up

1. Copy `docs/ga4/analytics.ts` into the app (e.g. `lib/analytics.ts`).
2. **signup_completed** — after sign-up succeeds (and only for brand-new accounts, not logins):
   ```ts
   trackOnce("signup_completed", user.id, { method: "email" });
   ```
   At the same moment, save the browser's GA client id so the server can attribute later events: `readGaClientId()` → store it on the user (e.g. a `ga_client_id` column on `profiles`, or auth `user_metadata`). It's a random browser id, not personal information.
3. **company_created** — after the company save succeeds: `track("company_created")`.
4. **first_invoice_created** — in the code that saves invoices: if the user had 0 invoices before this save and has ≥1 now, call `trackOnce("first_invoice_created", user.id)`. (More robust alternative: do it server-side with `trackServer()` from the place that persists the data, or a Supabase database webhook on `companies` updates.)
5. **subscription_activated** — in the server code that handles the Helcim success callback/webhook, *after* verifying the payment with Helcim and writing `user_subscriptions`:
   ```ts
   await trackServer({
     event: "subscription_activated",
     clientId: profile.ga_client_id,          // saved at signup
     params: { plan, billing_period, value: amount, currency: "CAD", transaction_id: String(helcimSubscriptionId) },
   });
   ```
   Because it runs only after Helcim confirms, GA4 can't count unpaid or failed attempts. `transaction_id` lets you spot duplicates.
6. In GA4 → Admin → **Events**, mark `signup_completed`, `first_invoice_created` and `subscription_activated` as **key events**. (Disable the old `sign_up` key event if it's the same thing, or the dashboard's "conversions" number will double count.)
7. Add `GA4_MEASUREMENT_ID` and `GA4_API_SECRET` to the app's server env.

## Testing

1. **Validate the payloads** (nothing is recorded): `GA4_MEASUREMENT_ID=G-… GA4_API_SECRET=… node docs/ga4/test-event.mjs` — each event must print `PASS`.
2. **Watch live**: GA4 → Admin → DebugView, open the app with the GA debug extension, and do the real flow with a test account.
3. **Verify against reality**: after a few days, open Growth → **Tracking check**. Each row should say OK:
   - browser events (`signup_completed`, `company_created`) may be up to ~30% under because of ad blockers;
   - server events (`first_invoice_created`, `subscription_activated`) should match closely. "Overcounting" usually means a double fire; "Not firing" means the name or trigger is wrong.
4. Exclude your own test accounts from GA4 (GA4 → Admin → Data filters, or filter by your test IP) so they don't inflate the counts — the dashboard already excludes them from the "real" side via `EXCLUDED_EMAILS`.
