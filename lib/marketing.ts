import "server-only";
import { getGa4Summary, EMPTY_GA4_SUMMARY, type Ga4Summary } from "./google/ga4";
import {
  getSearchConsoleSummary,
  EMPTY_SEARCH_CONSOLE_SUMMARY,
  type SearchConsoleSummary,
} from "./google/searchConsole";

export type MarketingMetrics = {
  ga4: Ga4Summary;
  searchConsole: SearchConsoleSummary;
  generatedAt: string;
};

export async function getMarketingMetrics(): Promise<MarketingMetrics> {
  // Each source fails independently — a Search Console hiccup shouldn't
  // take down GA4 data, and neither should block the rest of the
  // dashboard. isGoogleConfigured()/missing property or site env vars
  // already short-circuit to an empty, "not configured" result rather
  // than throwing, so this mainly guards against transient API errors.
  const [ga4, searchConsole] = await Promise.all([
    getGa4Summary().catch(() => EMPTY_GA4_SUMMARY),
    getSearchConsoleSummary().catch(() => EMPTY_SEARCH_CONSOLE_SUMMARY),
  ]);

  return { ga4, searchConsole, generatedAt: new Date().toISOString() };
}
