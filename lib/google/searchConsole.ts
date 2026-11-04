import "server-only";
import { google, type searchconsole_v1 } from "googleapis";
import { getGoogleAuth, isGoogleConfigured } from "./auth";

type QueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

type PageRow = {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type SearchConsoleSummary = {
  configured: boolean;
  clicks: number;
  impressions: number;
  ctr: number; // 0-1
  position: number; // average
  topQueries: QueryRow[];
  topPages: PageRow[];
  byDevice: { device: string; clicks: number; impressions: number }[];
  byCountry: { country: string; clicks: number; impressions: number }[];
  dailyTrend: { date: string; clicks: number; impressions: number }[];
  window: { startDate: string; endDate: string } | null;
  previousPeriod: {
    startDate: string;
    endDate: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  } | null; // the 28 days before the current window
  queryPages: {
    query: string;
    page: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }[]; // which page ranks for which query
  warnings: string[]; // optional reports that failed
};

export const EMPTY_SEARCH_CONSOLE_SUMMARY: SearchConsoleSummary = {
  configured: false,
  clicks: 0,
  impressions: 0,
  ctr: 0,
  position: 0,
  topQueries: [],
  topPages: [],
  byDevice: [],
  byCountry: [],
  dailyTrend: [],
  window: null,
  previousPeriod: null,
  queryPages: [],
  warnings: [],
};

// Search Console data typically lags 2-3 days behind today, so this
// window ends 3 days ago rather than "today" — matches what you'd see
// in the Search Console UI by default.
function dateRanges() {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date();
  end.setDate(end.getDate() - 3);
  const start = new Date(end);
  start.setDate(start.getDate() - 28);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - 28);
  return {
    current: { startDate: iso(start), endDate: iso(end) },
    previous: { startDate: iso(prevStart), endDate: iso(prevEnd) },
  };
}

export async function getSearchConsoleSummary(): Promise<SearchConsoleSummary> {
  const siteUrl = process.env.SEARCH_CONSOLE_SITE_URL;
  if (!isGoogleConfigured() || !siteUrl) {
    return EMPTY_SEARCH_CONSOLE_SUMMARY;
  }

  const auth = getGoogleAuth([
    "https://www.googleapis.com/auth/webmasters.readonly",
  ]);
  const searchconsole = google.searchconsole({ version: "v1", auth });
  const { current, previous } = dateRanges();
  const { startDate, endDate } = current;
  const warnings: string[] = [];

  type SCRes = searchconsole_v1.Schema$SearchAnalyticsQueryResponse;
  async function optional(
    name: string,
    body: searchconsole_v1.Schema$SearchAnalyticsQueryRequest
  ): Promise<SCRes | null> {
    try {
      const res = await searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: body,
      });
      return res.data;
    } catch (err) {
      warnings.push(`${name}: ${err instanceof Error ? err.message : "failed"}`);
      return null;
    }
  }

  const [totalsRes, queriesRes, pagesRes, deviceRes, countryRes, dailyRes] =
    await Promise.all([
      searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: { startDate, endDate },
      }),
      searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: { startDate, endDate, dimensions: ["query"], rowLimit: 25 },
      }),
      searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: { startDate, endDate, dimensions: ["page"], rowLimit: 25 },
      }),
      searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: { startDate, endDate, dimensions: ["device"] },
      }),
      searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: { startDate, endDate, dimensions: ["country"], rowLimit: 15 },
      }),
      searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: { startDate, endDate, dimensions: ["date"], rowLimit: 1000 },
      }),
    ]);

  const [previousRes, queryPagesRes] = await Promise.all([
    optional("previous period", { ...previous }),
    optional("query x page", {
      startDate,
      endDate,
      dimensions: ["query", "page"],
      rowLimit: 25,
    }),
  ]);

  const totals = totalsRes.data.rows?.[0];
  const prevTotals = previousRes?.rows?.[0];

  const topQueries: QueryRow[] = (queriesRes.data.rows ?? []).map((row) => ({
    query: row.keys?.[0] ?? "",
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));

  const topPages: PageRow[] = (pagesRes.data.rows ?? []).map((row) => ({
    page: row.keys?.[0] ?? "",
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));

  const byDevice = (deviceRes.data.rows ?? []).map((row) => ({
    device: row.keys?.[0] ?? "Unknown",
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
  }));

  const byCountry = (countryRes.data.rows ?? []).map((row) => ({
    // Search Console returns ISO 3166-1 alpha-3 country codes (e.g. "can"),
    // not readable names — shown as-is, uppercased, rather than
    // maintaining a full code->name table for a 10-row list.
    country: (row.keys?.[0] ?? "unknown").toUpperCase(),
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
  }));

  const dailyTrend = (dailyRes.data.rows ?? [])
    .map((row) => ({
      date: row.keys?.[0] ?? "",
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    configured: true,
    clicks: totals?.clicks ?? 0,
    impressions: totals?.impressions ?? 0,
    ctr: totals?.ctr ?? 0,
    position: totals?.position ?? 0,
    topQueries,
    topPages,
    byDevice,
    byCountry,
    dailyTrend,
    window: { startDate, endDate },
    previousPeriod: prevTotals
      ? {
          ...previous,
          clicks: prevTotals.clicks ?? 0,
          impressions: prevTotals.impressions ?? 0,
          ctr: prevTotals.ctr ?? 0,
          position: prevTotals.position ?? 0,
        }
      : null,
    queryPages: (queryPagesRes?.rows ?? []).map((row) => ({
      query: row.keys?.[0] ?? "",
      page: row.keys?.[1] ?? "",
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    })),
    warnings,
  };
}
