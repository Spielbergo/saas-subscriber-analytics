import type {
  BrokenLink,
  CrawlIssue,
  CrawlPage,
  CrawlResult,
  SecurityCheck,
  Severity,
} from "./types";
import { validateJsonLd } from "./schema";
import {
  isAllowedByRobots,
  looksLikeFile,
  normalizeUrl,
  parseHtml,
  parseRobots,
  parseSitemap,
  type ParsedLink,
  type RobotsRules,
} from "./html";

export type CrawlOptions = {
  startUrl: string;
  maxPages?: number;
  concurrency?: number;
  delayMs?: number;
  timeoutMs?: number;
  userAgent?: string;
  checkExternal?: boolean;
  checkImages?: boolean; // HEAD-check image sizes (default on)
  maxImages?: number;
  imageLimitBytes?: number; // "heavy" threshold, default 200 KB
  maxExternal?: number;
  onProgress?: (p: { crawled: number; queued: number; current: string | null }) => void;
  shouldStop?: () => boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One entry per issue code: how serious it is and what to do about it.
export const ISSUE_DEFS: Record<string, { severity: Severity; label: string; description: string }> = {
  http_4xx: { severity: "error", label: "Broken pages (4xx)", description: "Pages that return a client error such as 404. Fix the link or redirect the URL." },
  http_5xx: { severity: "error", label: "Server errors (5xx)", description: "Pages that fail on the server. These can't be indexed until fixed." },
  fetch_failed: { severity: "error", label: "Pages that failed to load", description: "Timeouts or network errors while crawling." },
  missing_title: { severity: "error", label: "Missing title", description: "Every page needs a unique <title>. It's the biggest on-page ranking and click factor." },
  broken_links_internal: { severity: "error", label: "Pages linking to broken pages", description: "These pages contain internal links that return 4xx/5xx." },
  noindex_in_sitemap: { severity: "error", label: "noindex pages listed in sitemap", description: "Sitemap URLs should be indexable. Remove them from the sitemap or remove the noindex." },
  title_too_long: { severity: "warning", label: "Title too long (>60 chars)", description: "Google typically truncates titles around 580px (≈60 characters)." },
  title_too_short: { severity: "warning", label: "Title too short (<30 chars)", description: "Short titles waste ranking and click-through opportunity." },
  duplicate_title: { severity: "warning", label: "Duplicate titles", description: "Pages sharing a title compete with each other and confuse searchers." },
  missing_meta: { severity: "warning", label: "Missing meta description", description: "Google may write its own snippet; a good description improves click-through." },
  meta_too_long: { severity: "warning", label: "Meta description too long (>160 chars)", description: "Long descriptions get truncated in results." },
  meta_too_short: { severity: "notice", label: "Meta description short (<70 chars)", description: "Room to say more about the page." },
  duplicate_meta: { severity: "warning", label: "Duplicate meta descriptions", description: "Each page should describe itself uniquely." },
  missing_h1: { severity: "warning", label: "Missing H1", description: "Each page should have one clear H1 heading." },
  multiple_h1: { severity: "notice", label: "Multiple H1 headings", description: "Usually one H1 per page is clearest." },
  thin_content: { severity: "warning", label: "Thin content (<300 words)", description: "Little text for search engines to understand. Fine for tools/login pages; a problem for content pages." },
  images_missing_alt: { severity: "warning", label: "Images missing alt text", description: "Alt text helps accessibility and image search." },
  redirect: { severity: "notice", label: "Internal redirects (3xx)", description: "Link straight to the final URL to save a hop." },
  redirect_chain: { severity: "warning", label: "Redirect chains", description: "A redirect that leads to another redirect. Point the first one directly at the final page." },
  canonical_missing: { severity: "notice", label: "No canonical tag", description: "A self-referencing canonical protects against duplicate-URL problems." },
  canonical_other: { severity: "notice", label: "Canonical points to another URL", description: "Google will usually index the canonical target instead of this page. Intentional?" },
  orphan_page: { severity: "warning", label: "Orphan pages (in sitemap, no internal links)", description: "Link to these from relevant pages so they can accumulate authority." },
  not_in_sitemap: { severity: "notice", label: "Indexable pages missing from sitemap", description: "Add them to the sitemap to help discovery." },
  slow_response: { severity: "warning", label: "Slow server response (>1.5s)", description: "Slow time-to-first-byte hurts crawl rate and user experience." },
  missing_viewport: { severity: "warning", label: "No mobile viewport tag", description: "Required for mobile-friendly rendering." },
  missing_og: { severity: "notice", label: "Missing Open Graph tags", description: "Social shares and link previews look better with og:title and og:image." },
  no_structured_data: { severity: "notice", label: "No structured data (JSON-LD)", description: "Schema markup can unlock rich results." },
  deep_page: { severity: "notice", label: "Deep pages (>3 clicks from home)", description: "Pages buried deep tend to be crawled and ranked less." },
  missing_lang: { severity: "notice", label: "Missing html lang attribute", description: "Helps search engines and screen readers." },
  noindex: { severity: "notice", label: "noindex pages", description: "Excluded from search on purpose? Verify." },
  heavy_images: { severity: "warning", label: "Heavy images (>200 KB)", description: "Large images slow the page and hurt Core Web Vitals (LCP). Resize, compress, or convert to WebP/AVIF." },
  images_no_dimensions: { severity: "notice", label: "Images without width/height", description: "Without dimensions the page jumps as images load (layout shift / CLS). Add width and height attributes." },
  mixed_content: { severity: "error", label: "Mixed content (http:// resources on https page)", description: "Browsers block or warn about insecure resources on secure pages. Load them over https." },
  schema_invalid: { severity: "error", label: "Invalid structured data (JSON-LD)", description: "The JSON-LD can't be parsed, so search engines ignore it." },
  schema_problems: { severity: "warning", label: "Structured data missing required properties", description: "The JSON-LD is valid JSON but is missing fields Google needs for rich results. See the page's details." },
  missing_security_headers: { severity: "warning", label: "Missing security headers (site-wide)", description: "Headers like HSTS, CSP, X-Content-Type-Options and Referrer-Policy protect visitors. Shown on the page the headers were read from." },
  no_https_redirect: { severity: "warning", label: "http:// doesn't redirect to https://", description: "Visitors and crawlers on the insecure URL should be sent to the https version with a 301." },
  broken_external: { severity: "warning", label: "Pages with broken external links", description: "Outbound links returning 404/410/5xx or unresolvable domains." },
};

// Key for comparing URLs ignoring a trailing slash (and the "/" vs "" root).
const key = (u: string) => {
  try {
    const x = new URL(u);
    const p = x.pathname.length > 1 && x.pathname.endsWith("/") ? x.pathname.slice(0, -1) : x.pathname;
    return `${x.origin}${p}${x.search}`;
  } catch {
    return u;
  }
};

function emptyPage(url: string, depth: number): CrawlPage {
  return {
    url, status: 0, error: null, redirectedTo: null, contentType: null, responseMs: 0, bytes: 0, depth,
    title: null, titleLength: 0, metaDescription: null, metaLength: 0, h1: [], h2Count: 0,
    canonical: null, robotsMeta: null, noindex: false, indexable: false, wordCount: 0,
    imagesTotal: 0, imagesMissingAlt: 0, internalLinks: 0, externalLinks: 0, inlinks: 0, lang: null,
    hasViewport: false, hasOgTitle: false, hasOgImage: false, hasJsonLd: false, inSitemap: false, issues: [],
  };
}

async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function crawlSite(opts: CrawlOptions): Promise<CrawlResult> {
  const startedAt = new Date();
  const maxPages = opts.maxPages ?? 150;
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const delayMs = opts.delayMs ?? 150;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const ua = opts.userAgent ?? "NorthBooksSEOAudit/1.0";
  const headers = { "user-agent": ua, accept: "text/html,application/xhtml+xml,*/*;q=0.8" };

  const start = normalizeUrl(opts.startUrl, opts.startUrl);
  if (!start) throw new Error(`Invalid start URL: ${opts.startUrl}`);
  const origin = new URL(start).origin;
  const host = new URL(start).hostname;
  const isInternal = (u: string) => {
    try {
      return new URL(u).hostname === host;
    } catch {
      return false;
    }
  };

  // ---- robots.txt + sitemap ----
  let rules: RobotsRules = { disallow: [], allow: [], sitemaps: [], blocksEverything: false };
  let robotsFound = false;
  try {
    const r = await timedFetch(`${origin}/robots.txt`, { headers }, timeoutMs);
    if (r.status === 200) {
      robotsFound = true;
      rules = parseRobots(await r.text(), ua);
    }
  } catch {
    /* no robots.txt reachable */
  }

  const sitemapUrls = new Set<string>(); // comparison keys
  const sitemapList: string[] = []; // URLs exactly as listed
  const sitemapQueue = rules.sitemaps.length ? [...rules.sitemaps] : [`${origin}/sitemap.xml`];
  const seenSitemaps = new Set<string>();
  while (sitemapQueue.length && seenSitemaps.size < 12 && sitemapUrls.size < 5000) {
    const sm = sitemapQueue.shift()!;
    if (seenSitemaps.has(sm)) continue;
    seenSitemaps.add(sm);
    try {
      const r = await timedFetch(sm, { headers }, timeoutMs);
      if (r.status !== 200) continue;
      const { urls, isIndex } = parseSitemap(await r.text());
      for (const u of urls) {
        if (isIndex) sitemapQueue.push(u);
        else {
          const n = normalizeUrl(u, origin);
          if (n && isInternal(n) && !sitemapUrls.has(key(n))) {
            sitemapUrls.add(key(n));
            sitemapList.push(n);
          }
        }
      }
    } catch {
      /* ignore unreachable sitemap */
    }
  }

  // ---- crawl ----
  const pages = new Map<string, CrawlPage>(); // by exact URL
  const queued = new Set<string>();
  const queue: { url: string; depth: number }[] = [];
  const skippedByRobots = new Set<string>();
  const outLinks = new Map<string, { to: string; anchor: string }[]>();
  const inGraph = new Map<string, Set<string>>(); // key(target) -> source urls
  const externalLinks = new Map<string, { from: string; anchor: string }[]>();
  const imageSources = new Map<string, Set<string>>(); // absolute image url -> pages using it
  let securityCheck: SecurityCheck | null = null;
  let truncated = false;
  let active = 0;
  let crawled = 0;

  const enqueue = (url: string, depth: number) => {
    const k = key(url);
    if (queued.has(k)) return;
    const u = new URL(url);
    if (!isAllowedByRobots(rules, u.pathname + u.search)) {
      skippedByRobots.add(url);
      queued.add(k);
      return;
    }
    queued.add(k);
    queue.push({ url, depth });
  };

  enqueue(start, 0);
  for (const sm of sitemapList) {
    if (!looksLikeFile(sm)) enqueue(sm, 1);
  }

  async function crawlOne(url: string, depth: number) {
    const page = emptyPage(url, depth);
    pages.set(url, page);
    const t0 = Date.now();
    try {
      const res = await timedFetch(url, { headers, redirect: "manual" }, timeoutMs);
      page.status = res.status;
      page.responseMs = Date.now() - t0;
      page.contentType = res.headers.get("content-type");

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        const target = loc ? normalizeUrl(loc, url) : null;
        page.redirectedTo = target;
        await res.body?.cancel().catch(() => {});
        if (target && isInternal(target) && !looksLikeFile(target)) enqueue(target, depth + 1);
        return;
      }

      const isHtml = (page.contentType ?? "").toLowerCase().includes("html");
      if (res.status === 200 && isHtml) {
        const body = await res.text();
        page.bytes = body.length;
        const p = parseHtml(body);
        page.title = p.title;
        page.titleLength = p.title?.length ?? 0;
        page.metaDescription = p.metaDescription;
        page.metaLength = p.metaDescription?.length ?? 0;
        page.h1 = p.h1;
        page.h2Count = p.h2Count;
        page.robotsMeta = p.robotsMeta;
        page.noindex = /\bnoindex\b|\bnone\b/i.test(p.robotsMeta ?? "") ||
          /\bnoindex\b/i.test(res.headers.get("x-robots-tag") ?? "");
        page.canonical = p.canonical ? normalizeUrl(p.canonical, url) : null;
        page.wordCount = p.wordCount;
        page.imagesTotal = p.imagesTotal;
        page.imagesMissingAlt = p.imagesMissingAlt;
        page.lang = p.lang;
        page.hasViewport = p.hasViewport;
        page.hasOgTitle = p.hasOgTitle;
        page.hasOgImage = p.hasOgImage;
        page.hasJsonLd = p.hasJsonLd;
        page.imagesNoDimensions = p.images.filter((i) => !i.hasDims).length;
        page.mixedContent = url.startsWith("https:") ? p.mixedContent : 0;
        if (p.jsonLdBlocks.length) {
          const v = validateJsonLd(p.jsonLdBlocks);
          page.schemaTypes = v.types;
          page.schemaProblems = v.problems;
        }
        for (const img of p.images) {
          const abs = normalizeUrl(img.src, url);
          if (!abs || imageSources.size >= (opts.maxImages ?? 120) * 2) continue;
          (imageSources.get(abs) ?? imageSources.set(abs, new Set()).get(abs)!).add(url);
        }
        // Security headers are site-wide, so read them once from the first HTML page.
        if (!securityCheck) {
          const hv = (n: string) => res.headers.get(n);
          securityCheck = {
            checkedUrl: url,
            https: url.startsWith("https:"),
            httpRedirectsToHttps: null,
            headers: [
              { name: "strict-transport-security", label: "HSTS", present: Boolean(hv("strict-transport-security")), value: hv("strict-transport-security"), advice: "Add Strict-Transport-Security: max-age=31536000; includeSubDomains" },
              { name: "content-security-policy", label: "Content-Security-Policy", present: Boolean(hv("content-security-policy")), value: hv("content-security-policy")?.slice(0, 160) ?? null, advice: "A CSP limits where scripts and resources can load from (start in report-only mode)." },
              { name: "x-content-type-options", label: "X-Content-Type-Options", present: /nosniff/i.test(hv("x-content-type-options") ?? ""), value: hv("x-content-type-options"), advice: "Add X-Content-Type-Options: nosniff" },
              { name: "x-frame-options", label: "X-Frame-Options / frame-ancestors", present: Boolean(hv("x-frame-options")) || /frame-ancestors/i.test(hv("content-security-policy") ?? ""), value: hv("x-frame-options"), advice: "Add X-Frame-Options: SAMEORIGIN (or CSP frame-ancestors) to prevent clickjacking." },
              { name: "referrer-policy", label: "Referrer-Policy", present: Boolean(hv("referrer-policy")), value: hv("referrer-policy"), advice: "Add Referrer-Policy: strict-origin-when-cross-origin" },
              { name: "permissions-policy", label: "Permissions-Policy", present: Boolean(hv("permissions-policy")), value: hv("permissions-policy")?.slice(0, 120) ?? null, advice: "Optional: Permissions-Policy limits browser features (camera, mic…)." },
            ],
          };
        }

        const internal = new Map<string, string>();
        const external = new Map<string, string>();
        for (const l of p.links as ParsedLink[]) {
          const n = normalizeUrl(l.href, url);
          if (!n) continue;
          if (isInternal(n)) internal.set(key(n), l.anchor);
          else external.set(n, l.anchor);
          if (isInternal(n) && !looksLikeFile(n) && !l.nofollow) enqueue(n, depth + 1);
        }
        const outs: { to: string; anchor: string }[] = [];
        for (const [k, anchor] of internal) {
          outs.push({ to: k, anchor });
          const set = inGraph.get(k) ?? new Set<string>();
          set.add(key(url));
          inGraph.set(k, set);
        }
        outLinks.set(url, outs);
        page.outlinks = outs.map((o) => { try { const x = new URL(o.to); return x.pathname + x.search; } catch { return o.to; } });
        page.internalLinks = internal.size;
        page.externalLinks = external.size;
        for (const [to, anchor] of external) {
          const list = externalLinks.get(to) ?? [];
          list.push({ from: url, anchor });
          externalLinks.set(to, list);
        }
      } else {
        await res.body?.cancel().catch(() => {});
      }
    } catch (err) {
      page.status = 0;
      page.error = err instanceof Error ? (err.name === "AbortError" ? "Timed out" : err.message) : "Fetch failed";
      page.responseMs = Date.now() - t0;
    }
  }

  async function worker() {
    while (true) {
      if (opts.shouldStop?.()) return;
      if (crawled >= maxPages) {
        if (queue.length) truncated = true;
        queue.length = 0;
      }
      const item = queue.shift();
      if (!item) {
        if (active === 0) return;
        await sleep(25);
        continue;
      }
      active += 1;
      try {
        await crawlOne(item.url, item.depth);
      } finally {
        crawled += 1;
        active -= 1;
        opts.onProgress?.({ crawled, queued: queue.length, current: item.url });
      }
      if (delayMs) await sleep(delayMs);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // ---- http -> https redirect ----
  if (securityCheck && start.startsWith("https:") && !opts.shouldStop?.()) {
    try {
      const r = await timedFetch(`http://${new URL(start).host}/`, { headers, redirect: "manual" }, 8000);
      const loc = r.headers.get("location") ?? "";
      (securityCheck as SecurityCheck).httpRedirectsToHttps = r.status >= 300 && r.status < 400 && loc.startsWith("https://");
      await r.body?.cancel().catch(() => {});
    } catch {
      /* port 80 closed or unreachable: leave as unknown */
    }
  }

  // ---- image weight (HEAD requests, capped) ----
  const imageBytes = new Map<string, number>();
  const imageLimit = opts.imageLimitBytes ?? 200_000;
  if (opts.checkImages !== false && imageSources.size && !opts.shouldStop?.()) {
    const imgTargets = Array.from(imageSources.keys()).slice(0, opts.maxImages ?? 120);
    let ii = 0;
    const imgWorker = async () => {
      while (ii < imgTargets.length) {
        const u = imgTargets[ii++];
        try {
          let r = await timedFetch(u, { method: "HEAD", headers, redirect: "follow" }, 8000);
          let len = Number(r.headers.get("content-length"));
          if ((!len || r.status === 405 || r.status === 403) && r.status !== 404) {
            r = await timedFetch(u, { method: "GET", headers, redirect: "follow" }, 10000);
            len = Number(r.headers.get("content-length")) || (await r.arrayBuffer()).byteLength;
          } else {
            await r.body?.cancel().catch(() => {});
          }
          if (r.ok && len > 0) imageBytes.set(u, len);
        } catch {
          /* unreachable image — the broken-link checks cover pages, not assets */
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, () => imgWorker()));
  }

  // ---- external link check (optional, capped) ----
  const brokenLinks: BrokenLink[] = [];
  const brokenExternalSources = new Set<string>();
  if (opts.checkExternal !== false && !opts.shouldStop?.()) {
    const targets = Array.from(externalLinks.keys()).slice(0, opts.maxExternal ?? 60);
    let idx = 0;
    const checkWorker = async () => {
      while (idx < targets.length) {
        const to = targets[idx++];
        let status = 0;
        let dnsFail = false;
        try {
          let r = await timedFetch(to, { method: "HEAD", headers, redirect: "follow" }, 8000);
          if (r.status === 405 || r.status === 403 || r.status === 501) {
            r = await timedFetch(to, { method: "GET", headers, redirect: "follow" }, 8000);
            await r.body?.cancel().catch(() => {});
          }
          status = r.status;
        } catch (err) {
          const cause = (err as { cause?: { code?: string } })?.cause?.code;
          dnsFail = cause === "ENOTFOUND";
        }
        const broken = status === 404 || status === 410 || status >= 500 || dnsFail;
        if (broken) {
          for (const src of externalLinks.get(to) ?? []) {
            brokenLinks.push({ from: src.from, to, status, anchor: src.anchor, external: true });
            brokenExternalSources.add(src.from);
          }
        }
        await sleep(100);
      }
    };
    await Promise.all(Array.from({ length: 4 }, () => checkWorker()));
  }

  // ---- analysis ----
  const byKey = new Map<string, CrawlPage>();
  for (const p of pages.values()) byKey.set(key(p.url), p);

  for (const p of pages.values()) {
    p.inlinks = inGraph.get(key(p.url))?.size ?? 0;
    p.inSitemap = sitemapUrls.has(key(p.url));
  }

  // Internal broken links (targets that were crawled and failed).
  const brokenInternalSources = new Set<string>();
  for (const [from, outs] of outLinks) {
    for (const o of outs) {
      const target = byKey.get(o.to);
      if (target && (target.status >= 400 || (target.status === 0 && target.error))) {
        brokenLinks.push({ from, to: target.url, status: target.status, anchor: o.anchor, external: false });
        brokenInternalSources.add(from);
      }
    }
  }

  const canonicalElsewhere = (p: CrawlPage) => Boolean(p.canonical) && key(p.canonical!) !== key(p.url);
  const html200 = (p: CrawlPage) => p.status === 200 && (p.contentType ?? "").toLowerCase().includes("html");

  for (const p of pages.values()) {
    p.indexable = html200(p) && !p.noindex && !canonicalElsewhere(p);
  }

  const titleGroups = new Map<string, CrawlPage[]>();
  const metaGroups = new Map<string, CrawlPage[]>();
  for (const p of pages.values()) {
    if (!p.indexable) continue;
    if (p.title) {
      const g = titleGroups.get(p.title.toLowerCase()) ?? [];
      g.push(p);
      titleGroups.set(p.title.toLowerCase(), g);
    }
    if (p.metaDescription) {
      const g = metaGroups.get(p.metaDescription.toLowerCase()) ?? [];
      g.push(p);
      metaGroups.set(p.metaDescription.toLowerCase(), g);
    }
  }

  const flag = (p: CrawlPage, code: string) => {
    if (!p.issues.includes(code)) p.issues.push(code);
  };

  for (const p of pages.values()) {
    if (p.status >= 400 && p.status < 500) flag(p, "http_4xx");
    else if (p.status >= 500) flag(p, "http_5xx");
    else if (p.status === 0) flag(p, "fetch_failed");

    if (p.status >= 300 && p.status < 400) {
      flag(p, "redirect");
      let hops = 1;
      let next = p.redirectedTo ? byKey.get(key(p.redirectedTo)) : undefined;
      const seen = new Set([key(p.url)]);
      while (next && next.status >= 300 && next.status < 400 && !seen.has(key(next.url)) && hops < 10) {
        seen.add(key(next.url));
        hops += 1;
        next = next.redirectedTo ? byKey.get(key(next.redirectedTo)) : undefined;
      }
      if (hops >= 2) flag(p, "redirect_chain");
    }

    if (brokenInternalSources.has(p.url)) flag(p, "broken_links_internal");
    if (brokenExternalSources.has(p.url)) flag(p, "broken_external");

    if (!html200(p)) continue;

    if (!p.title) flag(p, "missing_title");
    else if (p.titleLength > 60) flag(p, "title_too_long");
    else if (p.titleLength < 30) flag(p, "title_too_short");
    if (p.title && (titleGroups.get(p.title.toLowerCase())?.length ?? 0) > 1 && p.indexable) flag(p, "duplicate_title");

    if (!p.metaDescription) flag(p, "missing_meta");
    else {
      if (p.metaLength > 160) flag(p, "meta_too_long");
      else if (p.metaLength < 70) flag(p, "meta_too_short");
      if ((metaGroups.get(p.metaDescription.toLowerCase())?.length ?? 0) > 1 && p.indexable) flag(p, "duplicate_meta");
    }

    if (p.h1.length === 0) flag(p, "missing_h1");
    if (p.h1.length > 1) flag(p, "multiple_h1");
    if (p.wordCount < 300) flag(p, "thin_content");
    if (p.imagesMissingAlt > 0) flag(p, "images_missing_alt");
    if (!p.canonical) flag(p, "canonical_missing");
    else if (canonicalElsewhere(p)) flag(p, "canonical_other");
    if (p.responseMs > 1500) flag(p, "slow_response");
    if (!p.hasViewport) flag(p, "missing_viewport");
    if (!p.hasOgTitle || !p.hasOgImage) flag(p, "missing_og");
    if (!p.hasJsonLd) flag(p, "no_structured_data");
    if ((p.imagesNoDimensions ?? 0) > 0) flag(p, "images_no_dimensions");
    if ((p.mixedContent ?? 0) > 0) flag(p, "mixed_content");
    if (p.schemaProblems?.some((x) => x.startsWith("Invalid JSON"))) flag(p, "schema_invalid");
    if (p.schemaProblems?.some((x) => !x.startsWith("Invalid JSON"))) flag(p, "schema_problems");
    if (p.depth > 3) flag(p, "deep_page");
    if (!p.lang) flag(p, "missing_lang");
    if (p.noindex) flag(p, "noindex");
    if (p.noindex && p.inSitemap) flag(p, "noindex_in_sitemap");
    if (p.indexable && sitemapUrls.size > 0 && !p.inSitemap) flag(p, "not_in_sitemap");
    if (p.inSitemap && p.inlinks === 0 && key(p.url) !== key(start)) flag(p, "orphan_page");
  }

  // Heavy images per page (only images we managed to measure).
  const heavyPerPage = new Map<string, { url: string; bytes: number }[]>();
  let heavyCount = 0;
  let totalImageBytes = 0;
  for (const [u, bytes] of imageBytes) {
    totalImageBytes += bytes;
    if (bytes <= imageLimit) continue;
    heavyCount += 1;
    for (const pageUrl of imageSources.get(u) ?? []) {
      const list = heavyPerPage.get(pageUrl) ?? [];
      list.push({ url: u, bytes });
      heavyPerPage.set(pageUrl, list);
    }
  }
  for (const p of pages.values()) {
    const heavy = heavyPerPage.get(p.url);
    if (heavy?.length) {
      p.heavyImages = heavy.sort((a, b) => b.bytes - a.bytes).slice(0, 5);
      flag(p, "heavy_images");
    }
    const measured = Array.from(imageSources.entries()).filter(([, set]) => set.has(p.url)).map(([u]) => imageBytes.get(u)).filter((b): b is number => typeof b === "number");
    p.imageBytes = measured.length ? measured.reduce((a, b) => a + b, 0) : null;
  }

  // Site-wide security findings, attached to the page the headers came from.
  const sec = securityCheck as SecurityCheck | null;
  if (sec) {
    const secPage = byKey.get(key(sec.checkedUrl));
    if (secPage) {
      const essential = sec.headers.filter((h) => ["strict-transport-security", "x-content-type-options", "referrer-policy", "x-frame-options"].includes(h.name));
      if (sec.https && essential.some((h) => !h.present)) flag(secPage, "missing_security_headers");
      if (sec.https && sec.httpRedirectsToHttps === false) flag(secPage, "no_https_redirect");
    }
  }

  const issueMap = new Map<string, CrawlIssue>();
  for (const p of pages.values()) {
    for (const code of p.issues) {
      const def = ISSUE_DEFS[code];
      if (!def) continue;
      const cur = issueMap.get(code) ?? { code, ...def, urls: [] };
      cur.urls.push(p.url);
      issueMap.set(code, cur);
    }
  }
  const order: Record<Severity, number> = { error: 0, warning: 1, notice: 2 };
  const issues = Array.from(issueMap.values()).sort(
    (a, b) => order[a.severity] - order[b.severity] || b.urls.length - a.urls.length
  );

  // Health score: average per-page penalty.
  const scored = Array.from(pages.values()).filter((p) => html200(p) || p.status >= 300);
  let penalty = 0;
  for (const p of scored) {
    let pp = 0;
    for (const code of p.issues) {
      const sev = ISSUE_DEFS[code]?.severity;
      pp += sev === "error" ? 0.4 : sev === "warning" ? 0.12 : 0.02;
    }
    penalty += Math.min(1, pp);
  }
  const score = scored.length ? Math.round(100 * (1 - penalty / scored.length)) : 0;

  const finishedAt = new Date();
  return {
    site: origin,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSeconds: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
    pagesCrawled: pages.size,
    maxPages,
    truncated,
    score,
    robots: { found: robotsFound, sitemaps: rules.sitemaps, blocksEverything: rules.blocksEverything },
    sitemapUrlCount: sitemapUrls.size,
    pages: Array.from(pages.values()).sort((a, b) => a.url.localeCompare(b.url)),
    issues,
    brokenLinks,
    skippedByRobots: Array.from(skippedByRobots),
    security: sec,
    imageStats: imageBytes.size ? { checked: imageBytes.size, heavy: heavyCount, totalBytes: totalImageBytes, limitBytes: imageLimit } : null,
  };
}

