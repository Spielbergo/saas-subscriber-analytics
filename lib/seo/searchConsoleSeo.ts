import "server-only";
import { google } from "googleapis";
import { getGoogleAuth, isGoogleConfigured } from "../google/auth";
import { brandTerms } from "./config";
import { computeOpportunities, EMPTY_OPPORTUNITIES, type ScRow } from "./opportunities";
import type { Opportunities } from "./types";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

// Cached briefly so loading the SEO tab and then exporting doesn't make
// the same ~7 Search Console calls twice.
const g = globalThis as unknown as { __seoOpp?: { at: number; data: Opportunities } };
const TTL_MS = 10 * 60 * 1000;

export async function getOpportunities(force = false): Promise<Opportunities> {
  const siteUrl = process.env.SEARCH_CONSOLE_SITE_URL;
  if (!isGoogleConfigured() || !siteUrl) return EMPTY_OPPORTUNITIES;
  if (!force && g.__seoOpp && Date.now() - g.__seoOpp.at < TTL_MS) return g.__seoOpp.data;

  try {
    const auth = getGoogleAuth(["https://www.googleapis.com/auth/webmasters.readonly"]);
    const sc = google.searchconsole({ version: "v1", auth });

    // SC data lags ~3 days. Current = 28 days ending then; previous = the 28 before.
    const end = addDays(new Date(), -3);
    const start = addDays(end, -27);
    const prevEnd = addDays(start, -1);
    const prevStart = addDays(prevEnd, -27);
    const histStart = addDays(end, -90);

    const q = async (
      startDate: Date,
      endDate: Date,
      dimensions: string[],
      rowLimit: number
    ): Promise<ScRow[]> => {
      const res = await sc.searchanalytics.query({
        siteUrl,
        requestBody: { startDate: iso(startDate), endDate: iso(endDate), dimensions, rowLimit },
      });
      return (res.data.rows ?? []).map((r) => ({
        keys: r.keys ?? [],
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      }));
    };

    const [cur, prev, queryPages, pagesCur, pagesPrev, daily] = await Promise.all([
      q(start, end, ["query"], 1000),
      q(prevStart, prevEnd, ["query"], 1000),
      q(start, end, ["query", "page"], 5000),
      q(start, end, ["page"], 250),
      q(prevStart, prevEnd, ["page"], 250),
      q(histStart, end, ["date", "query"], 25000),
    ]);

    const data = computeOpportunities({
      cur,
      prev,
      queryPages,
      pagesCur,
      pagesPrev,
      daily,
      brandTerms: brandTerms(),
      window: { startDate: iso(start), endDate: iso(end) },
      previousWindow: { startDate: iso(prevStart), endDate: iso(prevEnd) },
    });
    g.__seoOpp = { at: Date.now(), data };
    return data;
  } catch (err) {
    return {
      ...EMPTY_OPPORTUNITIES,
      configured: true,
      error: err instanceof Error ? err.message : "Search Console request failed",
    };
  }
}
