import "server-only";
import { getBacklinkCache } from "./bing";
import { seoSiteUrl } from "./config";
import { loadLatestCrawl, getCrawlStatus } from "./crawlJob";
import { getSeoHistory } from "./history";
import { getPageSpeedCache } from "./pagespeed";
import { getOpportunities } from "./searchConsoleSeo";
import { getInspectionCache } from "./urlInspection";
import { isGoogleConfigured } from "../google/auth";
import type { SeoBundle } from "./types";

/** Everything the SEO tab and the AI export need, in one call. */
export async function getSeoBundle(): Promise<SeoBundle> {
  const site = seoSiteUrl();
  const [opportunities, crawl, history] = await Promise.all([getOpportunities(), loadLatestCrawl(), getSeoHistory().catch(() => undefined)]);
  return {
    siteUrl: site,
    crawlStatus: getCrawlStatus(),
    crawl,
    history,
    opportunities,
    inspections: getInspectionCache(),
    pagespeed: getPageSpeedCache(),
    backlinks: getBacklinkCache(),
    generatedAt: new Date().toISOString(),
    config: {
      siteUrl: site,
      searchConsole: isGoogleConfigured() && Boolean(process.env.SEARCH_CONSOLE_SITE_URL),
      pageSpeedKey: Boolean(process.env.PAGESPEED_API_KEY),
      bing: Boolean(process.env.BING_WEBMASTER_API_KEY),
    },
  };
}
