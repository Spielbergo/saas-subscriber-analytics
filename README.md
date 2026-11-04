# Subscriber Dashboard

Internal, admin-only dashboard for tracking subscriber/subscription
activity in your bookkeeping app. Reads from the **same Supabase
project** as your main app but never surfaces personal data (no emails,
names, or company names) — only counts, plans, statuses, and masked IDs.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Environment variables**

   Copy the example file and fill in your real values:

   ```bash
   cp .env.example .env.local
   ```

   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` —
     from Supabase Dashboard → Project Settings → API Keys. The
     publishable key is the modern, safe-for-the-browser replacement for
     the old "anon" key.
   - `SUPABASE_SECRET_KEY` — same page, under "Secret keys". The modern
     replacement for the old "service_role" key. **Never** prefix this
     with `NEXT_PUBLIC_` and never commit it. Used server-side only, to
     read subscription metrics regardless of the main app's RLS policies.
   - `ALLOWED_ADMIN_EMAILS` — comma-separated list of emails allowed to
     use this dashboard. Must match an existing account in this
     Supabase project's `auth.users` (e.g. your own account from signing
     up on the main app).

3. **Optional SQL migrations** — run these in Supabase's SQL editor
   any time, including later. Nothing on the dashboard breaks if you
   skip them; the relevant columns just show "—" until you do.

   - `sql/login_counts.sql` — enables the "Logins" count column.
   - Lead source needs no setup: it reads the attribution columns
     already on `profiles` (`first_touch_source`, `signup_touch_source`,
     `signup_utm_source/medium/campaign/content/term`, `signup_referrer`).

4. **Marketing section (optional)** — connects GA4 and Search Console.
   See `docs/marketing-setup.md` for the full walkthrough (Google Cloud
   service account, API enablement, env vars). Skip this and the
   Marketing section just shows a "not connected" notice.

5. **Run locally**

   ```bash
   npm run dev
   ```

   Visit `http://localhost:3000`, sign in with an allow-listed email.

## How auth works here (and why)

This dashboard uses **client-side Supabase Auth only** — no cookies, no
middleware, no SSR session syncing:

- Login happens in the browser; Supabase stores the session in
  `localStorage`, the library's default.
- The dashboard page checks for a session on load and redirects to
  `/login` if there isn't one.
- Data requests to `/api/metrics` send the user's access token as a
  `Bearer` header. The API route validates that token with Supabase,
  confirms the email is on `ALLOWED_ADMIN_EMAILS`, and only then queries
  the database with the secret key.

This is a deliberate simplification for a single-admin, locally-run
tool: cookie-based SSR auth (the original approach) is more robust for
multi-page public sites, but it's also the thing that caused the `431
Request Header Fields Too Large` error during setup — cookie chunking
and redirect loops are a known sharp edge with that pattern. Token-based
auth sidesteps it entirely. If you later add teammates or move to a
setup where server-rendered pages need to know who's logged in without
a client round-trip, cookie-based auth (via `@supabase/ssr`) is the
right tool then — just budget time to get the cookie handling exactly
right.

## Deploying to Vercel later

- Add the same four environment variables in Vercel's project settings.
- Double-check `SUPABASE_SECRET_KEY` is added as a regular (non-public)
  environment variable — Vercel keeps these server-side only, same as
  locally.
- Nothing else changes; this is a standard Next.js App Router project.

## Known limitations / things to improve later

- **Cancellation dates are approximate.** `user_subscriptions` has no
  `canceled_at` column, so a cancellation is inferred from
  `status = 'canceled'` using `updated_at` as a stand-in. If a
  subscription's status changes again later, that history is lost. For
  exact churn tracking, consider adding a `subscription_events` table
  (e.g. `id, user_id, subscription_id, event_type, plan, created_at`)
  and writing to it from wherever your app currently updates
  `user_subscriptions.status`.
- **MRR is estimated**, not billed revenue. `user_subscriptions.plan` is
  just a text label with no stored price, so `lib/planPricing.ts` maps
  plan names to dollar amounts by hand. Keep it in sync with your actual
  pricing (and consider currency/discounts if that ever applies).
- **Access control** is a simple email allow-list
  (`ALLOWED_ADMIN_EMAILS`), checked in `/api/metrics`. Fine for a single
  admin (you); if you ever add teammates, an `is_admin` column would
  scale better than an env var.

## Personal data

This dashboard now shows subscriber names, emails, and company names in
the "Subscribers" table, since it's an internal tool only you (an
allow-listed admin) can log into. The activity feed and upcoming-renewals
list still use short masked IDs instead of names, since those are meant
as a quick glance rather than a lookup. If you ever add teammates or
move this off `localhost`, revisit whether everyone who can log in
should see full subscriber PII, or whether it's worth splitting into a
"my eyes only" view vs. a broader team view.

## AI export

The **Export** button (next to Refresh) copies everything from all three tabs — overview, full subscriber table, GA4 and Search Console — as Markdown (best for pasting into an AI chat) or JSON. Names, emails and company names are masked by default; tick "Include names, emails & company names" to include them (the choice is remembered in your browser).

## GA4 shows zero key events?

GA4 only counts an event as a key event once your app fires it (e.g.
`sign_up`, `create_company`) and you mark it in GA4 under Admin → Events
→ "Mark as key event". The export's "Top events" table shows which event
names GA4 is receiving.

## Hiding test accounts

Set `EXCLUDED_EMAILS` in `.env.local` (comma-separated emails or `*`
patterns, e.g. `scott+test@yopie.ca,*@mytestdomain.com`) and restart.
Those users and all their subscriptions and companies are removed from
every number, table and the export. The header shows how many are hidden.

## SEO tab

Site audit crawler, keyword opportunities and rank tracker (from Search
Console), Google index coverage, PageSpeed, Bing backlinks and keyword
ideas — all free. See `docs/seo-setup.md`. The Export button includes
the latest SEO data too.

## Revenue, trends & goals (Helcim)

- **Revenue tab** – real MRR from Helcim subscriptions, failed payments, overdue billings, revenue by month, recent declines, and a Supabase↔Helcim reconciliation table. Set `HELCIM_API_TOKEN`. Users are matched to Helcim customers by `customerCode == user id`, else by email.
- **Trends tab** – daily snapshots (captured when you open the dashboard, and by the daily cron job (`/api/cron/daily`)), MRR/users/health/GA4/GSC charts, MRR movement (new/expansion/contraction/churn), ARPU, churn, LTV, annotations and an MRR goal (`MRR_GOAL`).
- Run `sql/admin_tables.sql` once in Supabase to keep history permanently (needed on Vercel). Locally it falls back to `.seo-cache/`.
- Helcim response field names were written without access to live data; if a number looks off, check the warnings shown on the Revenue tab and use "Copy for AI".

## Growth tab

- **Funnel** – visitors (GA4) → signed up → company → product/project → paid, with drop-off at each step, for 30d/90d/all-time signup cohorts.
- **Campaign ROI** – signups, set-up rate, building rate, paid rate and MRR by `utm_campaign`, `utm_content`, `utm_source` or lead source.
- **UTM builder & post log** – generates consistent tagged links; "Log this post" records it (and can drop a marker on the trend charts) and shows signups/paid per post, matched by campaign (+ content).
- **Brand mentions** – free Hacker News (Algolia) and Reddit searches, plus optional Google Alerts RSS (`GOOGLE_ALERTS_RSS`). Reddit sometimes blocks server-side requests; if so the tab says so and the other sources still work.

## CRM tab

Run **`sql/crm_data.sql`** once in the Supabase SQL editor (and `sql/admin_tables.sql` if you haven't) to enable everything below.

- **Subscriber drawer** – click any row (Subscribers, Pipeline, Follow-ups) for a timeline (signup, company, plan changes, first/last invoice, last login, your notes), product usage (invoices sent/paid, clients, time entries, expenses, bank statements, recurring items), billing, source, notes, tags, pipeline stage and follow-up date.
- **Pipeline** – lead → trial → customer, plus at risk and churned. Stages are automatic unless you set one by hand.
- **Reach out** – opens your own email app with a prefilled template chosen for the person's situation (onboarding help, at-risk check-in, inactive nudge, first-invoice nudge, payment issue, feedback, win-back). Nothing is sent by the dashboard. Set `OUTREACH_SENDER_NAME`.
- **CSV** – every table has a CSV button that downloads exactly the rows you're looking at (filters and sort applied).
- **Feature adoption** – % of users who created/sent/got paid on an invoice, added a client, logged time, tracked expenses, uploaded a bank statement, or use recurring items. Invoice usage also adds an "Invoicing" activation stage and a funnel step.
- **Cohort retention** – share of each signup-week cohort that logged in during weeks 1, 2, 4 and 8 afterwards (from Supabase's auth log, which is only retained for a limited time).

## SEO additions (Phase 4)

- **New audit checks** – heavy images (>200 KB, measured with HEAD requests on up to 120 images), images without width/height, mixed content, JSON-LD validation (invalid JSON, missing required properties for Organization, Product, SoftwareApplication, Article, FAQPage, BreadcrumbList…), security headers (HSTS, CSP, nosniff, frame protection, Referrer-Policy, Permissions-Policy) and whether http:// redirects to https://.
- **History tab** – every finished audit is saved; compare the last two to see newly affected and fixed URLs per issue. Also keeps Core Web Vitals history (every PageSpeed run) and Bing backlink snapshots with new/lost links and domains.
- **Internal links tab** – pages with Search Console impressions but few internal links, with related well-linked pages that should link to them and a suggested anchor.
- **Weekly audit** – `/api/cron/seo` (scheduled Mondays in `vercel.json`) crawls, saves the audit, runs PageSpeed on the home page and refreshes backlinks. It needs `CRON_SECRET`; on Vercel Hobby the crawl must finish within the function limit, so keep `SEO_CRAWL_MAX_PAGES` modest. Locally, just click "Re-run audit".
- History is stored in Supabase (`admin_kv`, from `sql/admin_tables.sql`) with a local-file fallback.
- Re-run the site audit once after updating — older crawls don't contain link targets, image sizes or schema data.

## Activation & GA4 tracking

- **Activated** = the user created an invoice, tracked an expense, or uploaded a bank statement (`lib/activation.ts`). Needs `sql/crm_data.sql`. Shown on Overview, Trends, the subscriber drawer, the funnel, campaign tables and exports. Creating a company/products/projects alone counts as setup, not activation.
- **Growth → Tracking check** compares GA4's `signup_completed`, `company_created`, `first_invoice_created` and `subscription_activated` counts (last 30 days) with the real counts from Supabase and Helcim, and warns if any page URL in GA4 contains an email-like "@".
- The events themselves must be sent from the main NorthBooks app — see `docs/ga4-events.md`, `docs/ga4/analytics.ts` (privacy-safe sender) and `docs/ga4/test-event.mjs` (validates the payloads against GA4's debug endpoint).


## Operations (uptime, SSL, domains, alerts, digest)

The **Ops** tab watches your sites and tells you when something needs attention. Everything is free: HTTP checks run from the dashboard, SSL expiry is read straight from the certificate, and domain expiry comes from RDAP.

**Set up**
1. Run `sql/admin_tables.sql` (it creates `admin_monitor_checks` and `admin_kv`). Without it, checks are kept in `.seo-cache/` and won't survive a deploy.
2. Set `MONITOR_URLS` (marketing site and app). `.vercel.app`-style hosts are skipped for domain expiry because you don't own them.
3. Add a channel: `SLACK_WEBHOOK_URL` (Slack → Apps → Incoming Webhooks) and/or `RESEND_API_KEY` + `ALERT_EMAIL_TO` + `ALERT_EMAIL_FROM` (Resend's free tier is plenty; the from address must be on a domain you've verified there). Click **Send test alert** to confirm.
4. Set `CRON_SECRET`.

**How checks run**
- While the dashboard is open, every 10 minutes (the server throttles to once per 5).
- Once a day via Vercel Cron (`/api/cron/daily` = snapshot → checks/alerts → digest; `/api/cron/seo` weekly). Hobby cron is daily only and allows very few jobs, so that is why the daily work is one route.
- For real 5-minute monitoring while you're away, point a free pinger (cron-job.org or UptimeRobot) at `https://YOUR-APP/api/cron/monitor?secret=YOUR_CRON_SECRET`.

**Alert behaviour** (de-duplicated, so you aren't spammed)
- Site down: after 2 failed checks in a row; reminder every 6 hours; a "resolved" message with how long it was down. Slow: 3 checks in a row over 4s.
- SSL: first alert at `ALERT_SSL_DAYS`, then again as it crosses 14 / 7 / 3 / 1 / 0 days. Also alerts if the certificate isn't trusted.
- Domain: first alert at `ALERT_DOMAIN_DAYS`, then again at 30 / 14 / 7 / 1 / 0 days. If your registry doesn't publish expiry (often `.ca`), the table says so; set `MONITOR_DOMAIN_EXPIRY=yourdomain.ca=YYYY-MM-DD`.
- Daily digest: MRR and change, signups, cancellations, follow-ups due, uptime/SSL/domain, SEO score, brand mentions. "Needs attention" only lists items that are *new* (failed Helcim payment, renewal overdue, new crawl issue types, SEO score drop of 5+, queries that lost 3+ positions with 50+ impressions); open items repeat weekly and are otherwise counted as "still open".
- `ALERT_INCLUDE_PII=false` replaces names with short ids in Slack/email.
- **Preview digest** shows exactly what would be sent without sending it. Every message is also logged on the Ops tab.

**Export:** section 8 of the Markdown report and `operations` in the JSON include uptime, SSL, domain status and recent alerts (alert text only when "include personal data" is on).

**Limits:** uptime is only as continuous as the checks that ran; gaps while nothing was polling aren't counted as downtime. Helcim/RDAP response details are best-effort.


## Date range & saved views

**Global date range** (under the tabs; remembered in your browser). Presets: 7d, 30d, 90d, YTD, 1y, All, or a custom from/to. It filters, client-side:
- **Trends** – snapshot charts, the data table and MRR movements (ARPU, churn and LTV keep using trailing history so they stay meaningful).
- **Subscribers** – people who *joined* in the range.
- **Growth** – the funnel (signups in the range; the funnel's own selector is replaced while a range is set), campaign table, logged posts (by post date) and brand mentions.
- **Revenue** – months and recent declines.
- **Overview** – the signups vs cancellations chart (the underlying series is the last 30 days).

It does **not** change GA4 (fixed 30 days) or Search Console (fixed 28 days) panels, the CRM, or the SEO crawl, and the Markdown/JSON export always contains everything (it just records which range you were viewing).

**Saved views** – tables with a **Views** button (subscribers, follow-ups, campaigns, posts, mentions, Helcim subscriptions, reconciliation, and the main SEO tables) can save the current search + filters + sort under a name. Click the star to open a view by default; "Reset" clears everything. Views are stored in your admin database (`admin_kv`, key `saved_views`) so they follow you from local to Vercel once you've run `sql/admin_tables.sql`; without it they go in `.seo-cache/` locally. Saving with an existing name replaces it. A saved filter whose column no longer exists is ignored rather than breaking the table. To add Views to another table, give its `<DataTable>` a unique `viewsKey`.
