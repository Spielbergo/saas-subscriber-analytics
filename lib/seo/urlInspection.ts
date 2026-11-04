import "server-only";
import { google } from "googleapis";
import { getGoogleAuth, isGoogleConfigured } from "../google/auth";
import { readCache, writeCache } from "./store";
import type { InspectionResult } from "./types";

export function getInspectionCache(): InspectionResult[] {
  return readCache<InspectionResult[]>("inspection.json", []);
}

/** Google's URL Inspection API — free, ~2,000 inspections/day per property. */
export async function inspectUrls(urls: string[]): Promise<InspectionResult[]> {
  const siteUrl = process.env.SEARCH_CONSOLE_SITE_URL;
  if (!isGoogleConfigured() || !siteUrl) {
    throw new Error("Search Console isn't configured (service account + SEARCH_CONSOLE_SITE_URL).");
  }
  const auth = getGoogleAuth(["https://www.googleapis.com/auth/webmasters.readonly"]);
  const sc = google.searchconsole({ version: "v1", auth });

  const results: InspectionResult[] = [];
  let idx = 0;
  const list = urls.slice(0, 60);
  const worker = async () => {
    while (idx < list.length) {
      const url = list[idx++];
      const base: InspectionResult = {
        url, inspectedAt: new Date().toISOString(), verdict: null, coverageState: null,
        indexingState: null, robotsTxtState: null, pageFetchState: null, lastCrawlTime: null,
        crawledAs: null, googleCanonical: null, userCanonical: null, sitemaps: [], error: null,
      };
      try {
        const res = await sc.urlInspection.index.inspect({
          requestBody: { inspectionUrl: url, siteUrl, languageCode: "en-US" },
        });
        const s = res.data.inspectionResult?.indexStatusResult;
        results.push({
          ...base,
          verdict: s?.verdict ?? null,
          coverageState: s?.coverageState ?? null,
          indexingState: s?.indexingState ?? null,
          robotsTxtState: s?.robotsTxtState ?? null,
          pageFetchState: s?.pageFetchState ?? null,
          lastCrawlTime: s?.lastCrawlTime ?? null,
          crawledAs: s?.crawledAs ?? null,
          googleCanonical: s?.googleCanonical ?? null,
          userCanonical: s?.userCanonical ?? null,
          sitemaps: s?.sitemap ?? [],
        });
      } catch (err) {
        results.push({ ...base, error: err instanceof Error ? err.message : "Inspection failed" });
      }
    }
  };
  await Promise.all(Array.from({ length: 3 }, () => worker()));

  const merged = new Map(getInspectionCache().map((r) => [r.url, r]));
  for (const r of results) {
    if (r.error && merged.has(r.url)) continue;
    merged.set(r.url, r);
  }
  writeCache("inspection.json", Array.from(merged.values()));
  return results;
}
