# Connecting GA4 and Search Console

Both use one Google Cloud service account — no OAuth login flow, since
this is a server-side admin tool reading your own data, not something
end users sign into.

## 1. Create the service account

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and
   create a project (or use an existing one).
2. Enable two APIs for that project:
   - **Google Analytics Data API**
   - **Google Search Console API**
   (Console → APIs & Services → Library → search for each → Enable.)
3. Console → APIs & Services → Credentials → Create Credentials →
   Service Account. Give it any name (e.g. `subscriber-dashboard`).
4. Open the new service account → Keys → Add Key → Create new key →
   JSON. This downloads a `.json` file — keep it safe, it's a secret
   credential.

## 2. Grant it access

The service account needs to be explicitly added as a viewer in both
products — creating it in Google Cloud doesn't give it access by
itself.

- **GA4**: Analytics → Admin → Property Access Management → "+" →
  add the service account's email (looks like
  `subscriber-dashboard@your-project.iam.gserviceaccount.com`) as
  **Viewer**.
- **Search Console**: Settings → Users and permissions → Add user →
  same email → **Full** or **Restricted** (Restricted is enough, since
  this only reads).

## 3. Fill in your `.env.local`

From the downloaded JSON key file:

```dotenv
GOOGLE_SERVICE_ACCOUNT_EMAIL=subscriber-dashboard@your-project.iam.gserviceaccount.com
# The "private_key" field from the JSON file, keeping the \n sequences as literal text
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"

# GA4: Admin > Property Settings > Property ID (numeric, not the G-XXXX measurement ID)
GA4_PROPERTY_ID=123456789

# Search Console: the exact property as it appears in Search Console.
# Either a URL-prefix property: https://yourapp.com/
# Or a domain property:         sc-domain:yourapp.com
SEARCH_CONSOLE_SITE_URL=https://yourapp.com/
```

The private key must stay on one line in `.env.local`, with `\n` as
literal two-character sequences (not real line breaks) — that's how
`.env` files represent multi-line values, and `lib/google/auth.ts`
un-escapes them at runtime.

## 4. Restart and check

Restart `npm run dev` (env vars only load at startup) and reload the
dashboard. The Marketing section will show live data once both are
configured — either one works independently, so you can set up GA4
first and add Search Console later (or vice versa) without anything
breaking in between.

## Notes

- **GA4 data** for "today" is usually still processing — the Sessions
  stat and chart cover the last 30 full days.
- **Search Console data** lags 2–3 days behind real-time; the dashboard
  already accounts for this by querying a trailing 28-day window ending
  3 days ago, same as what you'd see by default in the Search Console
  UI.
- **"Key events"** is GA4's current name for what used to be called
  "conversions" (Google renamed it in 2024; same underlying data). This
  will show 0 until you've marked at least one event as a key event in
  GA4 (Admin → Events → toggle "Mark as key event").
