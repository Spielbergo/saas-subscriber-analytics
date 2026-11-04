# SEO tab setup

Everything here is free. Nothing is sent to a paid SEO vendor.

| Feature | Data source | Setup |
|---|---|---|
| Site audit | Crawls your own site from your machine | Set `SEO_SITE_URL` (or it's derived from `SEARCH_CONSOLE_SITE_URL`) |
| Opportunities + rank tracker | Search Console (already connected for Marketing) | none |
| Indexing | Google URL Inspection API | none (same service account) |
| Speed / Core Web Vitals | Google PageSpeed Insights | optional `PAGESPEED_API_KEY` |
| Backlinks | Bing Webmaster Tools API | `BING_WEBMASTER_API_KEY` |
| Keyword ideas | Google autocomplete | none |

## Site audit
Click **Run site audit**. The crawler respects `robots.txt`, reads your
sitemap, follows internal links (default 150 pages, ~4 at a time with a
short delay), and checks titles, meta descriptions, H1s, canonicals,
noindex, redirects/chains, broken internal and external links, thin
content, image alt text, orphan pages, mobile viewport, Open Graph and
structured data. Results are saved in `.seo-cache/` so they survive a
restart. Only your own domain is crawled.

## Indexing
Uses the pages from the last audit. Google allows roughly 2,000 URL
inspections per day per property; each run inspects up to 60 pages.

## Backlinks
1. Add and verify your site in Bing Webmaster Tools (bing.com/webmasters —
   you can import it straight from Search Console).
2. Settings → API access → generate a key.
3. Add `BING_WEBMASTER_API_KEY` to `.env.local`, restart, click **Fetch backlinks**.

Bing only reports links it has found, so numbers will be much lower than
Ahrefs/Semrush. Google offers no API for its own link data.

## What's intentionally missing
Search volume, keyword difficulty, and a full backlink index are paid
datasets. The Opportunities tab uses your real Search Console
impressions and positions instead, which is usually more actionable for
a single site.

## Notes
- `.seo-cache/` is git-ignored. On Vercel the filesystem is ephemeral, so
  crawl results there would only live until the instance recycles.
- Don't point the crawler at sites you don't own.

## Sharing problems with an AI
- **Copy for AI** (top right of the SEO tab): errors & warnings with affected URLs and the actual evidence (the title text, the redirect target, the broken link), wrapped in a ready-made prompt. Also: all issues, the full report, or a .md download.
- **Copy this issue for AI** appears when you click an issue.
- Every table has **Copy table** — it copies exactly the rows you're looking at (filters and sort applied) as Markdown.
- Error messages anywhere in the dashboard have a **Copy error** button.
