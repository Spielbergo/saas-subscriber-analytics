import "server-only";
import { crawlSite } from "./crawler";
import { CRAWL_MAX_PAGES, seoSiteUrl } from "./config";
import { readCache, writeCache } from "./store";
import { kvGet, kvSet } from "../adminStore";
import { recordAudit } from "./history";
import type { CrawlResult, CrawlStatus } from "./types";

type JobState = { status: CrawlStatus; result: CrawlResult | null; stop: boolean };

// Held on globalThis so Next's dev hot-reload doesn't lose a running crawl.
const g = globalThis as unknown as { __seoCrawlJob?: JobState };
const job: JobState = (g.__seoCrawlJob ??= {
  status: { state: "idle", crawled: 0, queued: 0, current: null, startedAt: null, error: null },
  result: null,
  stop: false,
});

export function getCrawlStatus(): CrawlStatus {
  return job.status;
}

export function getCrawlResult(): CrawlResult | null {
  if (job.result) return job.result;
  const cached = readCache<CrawlResult | null>("crawl.json", null);
  if (cached) job.result = cached;
  return job.result;
}

/** Like getCrawlResult, but also falls back to the copy saved in Supabase (survives Vercel cold starts). */
export async function loadLatestCrawl(): Promise<CrawlResult | null> {
  const local = getCrawlResult();
  if (local) return local;
  const remote = await kvGet<CrawlResult | null>("seo_crawl_latest", null);
  if (remote) job.result = remote;
  return job.result;
}

export function stopCrawl(): void {
  job.stop = true;
}

/** Runs a crawl to completion (shared by the button and the scheduled job). */
async function runCrawl(site: string): Promise<CrawlResult> {
  job.stop = false;
  job.status = { state: "running", crawled: 0, queued: 0, current: null, startedAt: new Date().toISOString(), error: null };
  try {
    const result = await crawlSite({
      startUrl: site,
      maxPages: CRAWL_MAX_PAGES,
      shouldStop: () => job.stop,
      onProgress: (p) => {
        job.status = { ...job.status, crawled: p.crawled, queued: p.queued, current: p.current };
      },
    });
    job.result = result;
    writeCache("crawl.json", result);
    job.status = { ...job.status, state: "done", queued: 0, current: null };
    // History + a durable copy of the latest crawl (best-effort).
    if (!job.stop) {
      await recordAudit(result).catch(() => {});
      await kvSet("seo_crawl_latest", result).catch(() => {});
    }
    return result;
  } catch (err) {
    job.status = { ...job.status, state: "error", error: err instanceof Error ? err.message : "Crawl failed" };
    throw err;
  }
}

export function startCrawl(): { started: boolean; reason?: string } {
  if (job.status.state === "running") return { started: false, reason: "A crawl is already running." };
  const site = seoSiteUrl();
  if (!site) {
    return { started: false, reason: "No site configured — set SEO_SITE_URL (or SEARCH_CONSOLE_SITE_URL) in .env.local." };
  }
  // Fire and forget — the UI polls getCrawlStatus().
  void runCrawl(site).catch(() => {});
  return { started: true };
}

/** For the scheduled job: wait for the crawl to finish. */
export async function crawlNow(): Promise<CrawlResult> {
  if (job.status.state === "running") throw new Error("A crawl is already running.");
  const site = seoSiteUrl();
  if (!site) throw new Error("No site configured — set SEO_SITE_URL.");
  return runCrawl(site);
}
