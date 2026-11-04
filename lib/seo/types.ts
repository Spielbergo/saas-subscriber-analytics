// Shared SEO types. Client-safe (types only, no imports).

export type Severity = "error" | "warning" | "notice";

export type CrawlPage = {
  url: string;
  status: number; // 0 = network error / timeout
  error: string | null;
  redirectedTo: string | null;
  contentType: string | null;
  responseMs: number;
  bytes: number;
  depth: number;
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaLength: number;
  h1: string[];
  h2Count: number;
  canonical: string | null;
  robotsMeta: string | null;
  noindex: boolean;
  indexable: boolean; // 200, HTML, not noindex, canonical not pointing elsewhere
  wordCount: number;
  imagesTotal: number;
  imagesMissingAlt: number;
  internalLinks: number;
  externalLinks: number;
  inlinks: number; // distinct internal pages linking here
  lang: string | null;
  hasViewport: boolean;
  hasOgTitle: boolean;
  hasOgImage: boolean;
  hasJsonLd: boolean;
  inSitemap: boolean;
  issues: string[]; // issue codes
  // Added in Phase 4 — optional so older cached crawls still load.
  outlinks?: string[]; // distinct internal link targets, as path+query
  imagesNoDimensions?: number; // <img> without width/height (layout-shift risk)
  heavyImages?: { url: string; bytes: number }[]; // biggest images over the weight limit
  imageBytes?: number | null; // total of the images we could measure
  mixedContent?: number; // http:// resources on an https page
  schemaTypes?: string[]; // JSON-LD @types found
  schemaProblems?: string[]; // validation problems in the JSON-LD
};

export type SecurityHeader = { name: string; label: string; present: boolean; value: string | null; advice: string };

export type SecurityCheck = {
  checkedUrl: string;
  https: boolean;
  httpRedirectsToHttps: boolean | null; // null = couldn't tell
  headers: SecurityHeader[];
};

export type CrawlIssue = {
  code: string;
  severity: Severity;
  label: string;
  description: string; // why it matters / how to fix
  urls: string[];
};

export type BrokenLink = {
  from: string;
  to: string;
  status: number;
  anchor: string;
  external: boolean;
};

export type CrawlResult = {
  site: string;
  startedAt: string;
  finishedAt: string;
  durationSeconds: number;
  pagesCrawled: number;
  maxPages: number;
  truncated: boolean; // true if more pages were discovered than maxPages
  score: number; // 0-100
  robots: {
    found: boolean;
    sitemaps: string[];
    blocksEverything: boolean;
  };
  sitemapUrlCount: number;
  pages: CrawlPage[];
  issues: CrawlIssue[];
  brokenLinks: BrokenLink[];
  skippedByRobots: string[];
  security?: SecurityCheck | null;
  imageStats?: { checked: number; heavy: number; totalBytes: number; limitBytes: number } | null;
};

export type CrawlStatus = {
  state: "idle" | "running" | "done" | "error";
  crawled: number;
  queued: number;
  current: string | null;
  startedAt: string | null;
  error: string | null;
};

// ---------- Search Console opportunities ----------

export type QueryStat = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type QueryOpportunity = QueryStat & {
  page: string | null; // best-ranking page for this query
  estimatedExtraClicks: number;
};

export type QueryChange = QueryStat & {
  prevClicks: number;
  prevImpressions: number;
  prevPosition: number | null;
  deltaClicks: number;
  deltaPosition: number | null; // negative = improved
};

export type Cannibalization = {
  query: string;
  totalImpressions: number;
  pages: { page: string; clicks: number; impressions: number; position: number }[];
};

export type PageChange = {
  page: string;
  clicks: number;
  impressions: number;
  prevClicks: number;
  prevImpressions: number;
  deltaClicks: number;
  deltaPct: number; // -0.4 = down 40%
};

export type RankTrend = {
  query: string;
  impressions: number;
  clicks: number;
  currentPosition: number;
  // Impression-weighted weekly average position, oldest first.
  weeks: { weekStart: string; position: number; clicks: number; impressions: number }[];
};

export type Opportunities = {
  configured: boolean;
  window: { startDate: string; endDate: string } | null;
  previousWindow: { startDate: string; endDate: string } | null;
  totalQueries: number;
  brand: { terms: string[]; brandedClicks: number; nonBrandedClicks: number; brandedQueries: number; nonBrandedQueries: number };
  strikingDistance: QueryOpportunity[];
  lowCtr: QueryOpportunity[];
  rising: QueryChange[];
  falling: QueryChange[];
  newQueries: QueryStat[];
  lostQueries: QueryStat[];
  cannibalization: Cannibalization[];
  decayingPages: PageChange[];
  growingPages: PageChange[];
  rankTrends: RankTrend[];
  rankedQueries: string[]; // lowercase list, used to flag keyword ideas you already rank for
  pageQueries: { page: string; clicks: number; impressions: number; queries: { query: string; clicks: number; impressions: number }[] }[]; // top pages with their top queries
  topPages: { page: string; clicks: number; impressions: number }[];
  error: string | null;
};

// ---------- Indexing / speed / backlinks ----------

export type InspectionResult = {
  url: string;
  inspectedAt: string;
  verdict: string | null; // PASS | NEUTRAL | FAIL
  coverageState: string | null;
  indexingState: string | null;
  robotsTxtState: string | null;
  pageFetchState: string | null;
  lastCrawlTime: string | null;
  crawledAs: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  sitemaps: string[];
  error: string | null;
};

export type PageSpeedResult = {
  url: string;
  strategy: "mobile" | "desktop";
  fetchedAt: string;
  performance: number | null; // 0-100
  seo: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  lcpMs: number | null;
  fcpMs: number | null;
  tbtMs: number | null;
  cls: number | null;
  speedIndexMs: number | null;
  fieldLcpMs: number | null; // real-user (CrUX), if enough traffic
  fieldCls: number | null;
  fieldInpMs: number | null;
  fieldCategory: string | null; // FAST | AVERAGE | SLOW
  opportunities: { title: string; savings: string | null }[];
  error: string | null;
};

export type BacklinkTarget = { url: string; count: number };
export type BacklinkSample = { target: string; source: string; anchor: string | null };

export type BacklinkData = {
  configured: boolean;
  fetchedAt: string | null;
  siteUrl: string | null;
  totalLinks: number;
  targets: BacklinkTarget[]; // pages on your site receiving links
  samples: BacklinkSample[]; // sample of inbound links for the top targets
  referringDomains: { domain: string; links: number }[]; // from the sample only
  error: string | null;
};

export type SeoBundle = {
  siteUrl: string | null;
  crawlStatus: CrawlStatus;
  crawl: CrawlResult | null;
  opportunities: Opportunities;
  inspections: InspectionResult[];
  pagespeed: PageSpeedResult[];
  backlinks: BacklinkData;
  history?: SeoHistory;
  generatedAt: string;
  config: {
    siteUrl: string | null;
    searchConsole: boolean;
    pageSpeedKey: boolean;
    bing: boolean;
  };
};

export type KeywordIdea = {
  keyword: string;
  kind: "question" | "comparison" | "modifier" | "suggestion";
};

// ---------- History (Phase 4) ----------

export type AuditSnap = {
  at: string;
  score: number;
  pages: number;
  errors: number; // page-level counts, same as the Site audit cards
  warnings: number;
  notices: number;
  counts: Record<string, number>; // issue code -> affected pages
  // Affected URLs per issue code. Only kept on the most recent audits
  // (older ones keep counts only) to keep the history small.
  urls?: Record<string, string[]>;
};

export type CwvPoint = {
  at: string;
  url: string;
  strategy: "mobile" | "desktop";
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fieldLcpMs: number | null;
  fieldCls: number | null;
  fieldInpMs: number | null;
};

export type BacklinkSnap = {
  at: string;
  totalLinks: number;
  targets: BacklinkTarget[];
  domains: { domain: string; links: number }[];
  // "source|target" pairs from the sampled links — only on recent snapshots.
  links?: string[];
};

export type SeoHistory = {
  audits: AuditSnap[];
  cwv: CwvPoint[];
  backlinks: BacklinkSnap[];
  durable: boolean;
};
