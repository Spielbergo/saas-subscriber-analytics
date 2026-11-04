import type { CrawlIssue, CrawlPage, CrawlResult, SeoBundle, Severity } from "./types";

// Builds paste-ready text for handing SEO problems to an AI. Pure and
// client-safe (types only). Each issue lists its affected URLs *with the
// evidence* (the actual title, the redirect target, the broken link…) so
// the AI can give specific fixes instead of generic advice.

const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search || "/";
  } catch {
    return u;
  }
};
const q = (s: string | null | undefined, max = 120) =>
  s ? `"${s.length > max ? `${s.slice(0, max - 1)}…` : s}"` : "(none)";

export const AI_PREAMBLE = (site: string | null) =>
  `You are a senior technical SEO engineer. Below are findings from an automated audit of ${site ?? "my website"} ` +
  `(a bookkeeping SaaS, NorthBooks). For each issue: (1) explain the most likely root cause, (2) give the exact fix — ` +
  `code, config or content change — (3) rate priority (high/medium/low) by SEO impact vs effort. Group issues that share a ` +
  `root cause. If you need information I haven't given (e.g. my framework or CMS), list your questions at the end instead of guessing.`;

/** What to show next to a URL for a given issue code. */
function evidence(code: string, p: CrawlPage, crawl: CrawlResult): string {
  switch (code) {
    case "missing_title":
    case "title_too_long":
    case "title_too_short":
    case "duplicate_title":
      return `title ${q(p.title)} (${p.titleLength} chars)`;
    case "missing_meta":
    case "meta_too_long":
    case "meta_too_short":
    case "duplicate_meta":
      return `meta description ${q(p.metaDescription)} (${p.metaLength} chars)`;
    case "missing_h1":
    case "multiple_h1":
      return p.h1.length ? `H1s: ${p.h1.map((h) => q(h, 60)).join(" | ")}` : "no H1 found";
    case "thin_content":
      return `${p.wordCount} words`;
    case "images_missing_alt":
      return `${p.imagesMissingAlt} of ${p.imagesTotal} images lack alt`;
    case "redirect":
    case "redirect_chain":
      return `${p.status} → ${p.redirectedTo ?? "?"}`;
    case "canonical_missing":
      return "no canonical tag";
    case "canonical_other":
      return `canonical → ${p.canonical}`;
    case "orphan_page":
    case "not_in_sitemap":
      return `${p.inlinks} internal links in · ${p.inSitemap ? "in" : "not in"} sitemap`;
    case "heavy_images":
      return (p.heavyImages ?? []).map((i) => `${path(i.url)} ${Math.round(i.bytes / 1000)} KB`).join("; ");
    case "images_no_dimensions":
      return `${p.imagesNoDimensions ?? 0} of ${p.imagesTotal} images lack width/height`;
    case "mixed_content":
      return `${p.mixedContent ?? 0} http:// resources on this https page`;
    case "schema_invalid":
    case "schema_problems":
      return `types: ${(p.schemaTypes ?? []).join(", ") || "none"} · problems: ${(p.schemaProblems ?? []).join("; ")}`;
    case "missing_security_headers":
    case "no_https_redirect":
      return `site-wide: ${(crawl.security?.headers ?? []).filter((h) => !h.present).map((h) => h.label).join(", ") || "headers ok"}${crawl.security?.httpRedirectsToHttps === false ? " · http:// does not redirect to https://" : ""}`;
    case "slow_response":
      return `${p.responseMs} ms`;
    case "deep_page":
      return `${p.depth} clicks from home`;
    case "noindex":
    case "noindex_in_sitemap":
      return `robots meta: ${p.robotsMeta ?? "?"}${p.inSitemap ? " · listed in sitemap" : ""}`;
    case "http_4xx":
    case "http_5xx":
    case "fetch_failed": {
      const from = crawl.brokenLinks.filter((b) => b.to === p.url && !b.external).slice(0, 3).map((b) => path(b.from));
      return `status ${p.status || "no response"}${p.error ? ` (${p.error})` : ""}${from.length ? ` · linked from ${from.join(", ")}` : ""}`;
    }
    case "broken_links_internal":
    case "broken_external": {
      const ext = code === "broken_external";
      const links = crawl.brokenLinks.filter((b) => b.from === p.url && b.external === ext).slice(0, 4);
      return links.map((b) => `${ext ? b.to : path(b.to)} [${b.status || "no response"}]${b.anchor ? ` anchor ${q(b.anchor, 40)}` : ""}`).join("; ");
    }
    default:
      return "";
  }
}

function issueBlock(issue: CrawlIssue, crawl: CrawlResult, maxUrls: number): string {
  const byUrl = new Map(crawl.pages.map((p) => [p.url, p]));
  const lines = issue.urls.slice(0, maxUrls).map((u) => {
    const p = byUrl.get(u);
    const ev = p ? evidence(issue.code, p, crawl) : "";
    return `  - ${path(u)}${ev ? ` — ${ev}` : ""}`;
  });
  return (
    `### [${issue.severity.toUpperCase()}] ${issue.label} — ${issue.urls.length} page${issue.urls.length === 1 ? "" : "s"}\n` +
    `${issue.description}\n${lines.join("\n")}` +
    (issue.urls.length > maxUrls ? `\n  - …and ${issue.urls.length - maxUrls} more` : "")
  );
}

export function buildIssuesReport(
  bundle: SeoBundle,
  opts: { severities?: Severity[]; codes?: string[]; maxUrlsPerIssue?: number; includeOther?: boolean; preamble?: boolean } = {}
): string {
  const { severities, codes, maxUrlsPerIssue = 25, includeOther = true, preamble = true } = opts;
  const out: string[] = [];
  if (preamble) out.push(AI_PREAMBLE(bundle.siteUrl), "");

  const crawl = bundle.crawl;
  if (crawl) {
    const issues = crawl.issues.filter(
      (i) => (!severities || severities.includes(i.severity)) && (!codes || codes.includes(i.code))
    );
    out.push(
      `## Site audit — crawled ${crawl.finishedAt.slice(0, 10)}, ${crawl.pagesCrawled} pages, health score ${crawl.score}/100` +
        (crawl.robots.blocksEverything ? "\n⚠ robots.txt blocks all crawlers" : "") +
        (crawl.robots.found ? "" : "\n⚠ no robots.txt found") +
        (crawl.sitemapUrlCount === 0 ? "\n⚠ no sitemap found" : "")
    );
    out.push("");
    if (issues.length === 0) out.push("No issues matched.");
    for (const i of issues) out.push(issueBlock(i, crawl, maxUrlsPerIssue), "");
  } else if (!codes) {
    out.push("## Site audit\nNo audit has been run yet.", "");
  }

  if (includeOther && !codes) {
    const badIdx = bundle.inspections.filter((i) => i.error || i.verdict !== "PASS");
    if (badIdx.length) {
      out.push(`## Google index problems (${badIdx.length} of ${bundle.inspections.length} inspected pages)`);
      for (const i of badIdx.slice(0, 40)) {
        out.push(`  - ${path(i.url)} — ${i.error ?? `${i.verdict}: ${i.coverageState ?? "unknown"}`}${i.googleCanonical && i.userCanonical && i.googleCanonical !== i.userCanonical ? ` · Google chose canonical ${i.googleCanonical}` : ""}`);
      }
      out.push("");
    }
    const slow = bundle.pagespeed.filter((r) => !r.error && r.performance !== null && r.performance < 90);
    if (slow.length) {
      out.push("## Speed problems (PageSpeed Insights, score < 90)");
      for (const r of slow) {
        out.push(
          `  - ${path(r.url)} (${r.strategy}) perf ${r.performance}, LCP ${r.lcpMs === null ? "?" : (r.lcpMs / 1000).toFixed(1)}s, CLS ${r.cls ?? "?"}, TBT ${r.tbtMs === null ? "?" : Math.round(r.tbtMs)}ms` +
            (r.opportunities.length ? `\n      fixes suggested by Lighthouse: ${r.opportunities.map((o) => `${o.title}${o.savings ? ` (${o.savings})` : ""}`).join("; ")}` : "")
        );
      }
      out.push("");
    }
    const cann = bundle.opportunities.cannibalization.slice(0, 10);
    if (cann.length) {
      out.push("## Keyword cannibalization (several pages compete for one query)");
      for (const c of cann) {
        out.push(`  - "${c.query}" (${c.totalImpressions} impressions): ${c.pages.map((p) => `${path(p.page)} pos ${p.position.toFixed(1)}`).join(" vs ")}`);
      }
      out.push("");
    }
    const decay = bundle.opportunities.decayingPages.slice(0, 10);
    if (decay.length) {
      out.push("## Pages losing search traffic (vs previous 28 days)");
      for (const d of decay) out.push(`  - ${path(d.page)}: ${d.prevClicks} → ${d.clicks} clicks (${Math.round(d.deltaPct * 100)}%)`);
      out.push("");
    }
  }

  return out.join("\n").trim() + "\n";
}

/** A single issue, ready to paste with the preamble. */
export const buildSingleIssueReport = (bundle: SeoBundle, code: string) =>
  buildIssuesReport(bundle, { codes: [code], maxUrlsPerIssue: 60, includeOther: false });
