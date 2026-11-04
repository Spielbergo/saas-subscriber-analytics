import "server-only";
import { google, type analyticsdata_v1beta } from "googleapis";
import { getGoogleAuth, isGoogleConfigured } from "./auth";
import { TRACKED_EVENTS } from "../tracking";

type Totals = {
  sessions: number;
  totalUsers: number;
  newUsers: number;
  conversions: number; // GA4 "key events" (formerly conversions)
  engagedSessions: number;
  engagementRate: number; // 0-1
  avgEngagementSeconds: number;
};

export type Ga4Summary = {
  configured: boolean;
  sessions: number;
  totalUsers: number;
  newUsers: number;
  conversions: number; // count of the "sign_up" key event, if configured in GA4
  engagementRate: number; // 0-1
  avgEngagementSeconds: number;
  engagedSessions: number;
  previousPeriod: Totals | null; // the 30 days before the current window
  byChannel: { channel: string; sessions: number }[];
  dailySessions: {
    date: string;
    sessions: number;
    users: number;
    newUsers: number;
    keyEvents: number;
  }[]; // last 30 days
  topLandingPages: {
    page: string;
    sessions: number;
    newUsers: number;
    engagementRate: number;
    keyEvents: number;
  }[];
  topPages: { page: string; views: number; users: number }[];
  bySourceMedium: {
    sourceMedium: string;
    sessions: number;
    newUsers: number;
    engagementRate: number;
    keyEvents: number;
  }[];
  byCampaign: { campaign: string; sessions: number; keyEvents: number }[];
  topEvents: { event: string; count: number; users: number }[];
  trackedEvents: { event: string; count: number; users: number }[]; // the four conversion events, last 30 days
  piiUrlHits: number | null; // page URLs containing an email-like "@" (privacy leak), null if the check failed
  piiUrlSamples: string[]; // masked
  byDevice: { device: string; sessions: number }[];
  byCountry: { country: string; sessions: number }[];
  byCity: { city: string; sessions: number }[];
  byBrowser: { browser: string; sessions: number }[];
  newVsReturning: { new: number; returning: number };
  // Names of any optional reports that failed (bad dimension for this
  // property, quota, etc.) — the core numbers still load without them.
  warnings: string[];
};

export const EMPTY_GA4_SUMMARY: Ga4Summary = {
  configured: false,
  sessions: 0,
  totalUsers: 0,
  newUsers: 0,
  conversions: 0,
  engagementRate: 0,
  avgEngagementSeconds: 0,
  engagedSessions: 0,
  previousPeriod: null,
  byChannel: [],
  dailySessions: [],
  topLandingPages: [],
  topPages: [],
  bySourceMedium: [],
  byCampaign: [],
  topEvents: [],
  trackedEvents: [],
  piiUrlHits: null,
  piiUrlSamples: [],
  byDevice: [],
  byCountry: [],
  byCity: [],
  byBrowser: [],
  newVsReturning: { new: 0, returning: 0 },
  warnings: [],
};

type Report = analyticsdata_v1beta.Schema$RunReportResponse;
type Row = analyticsdata_v1beta.Schema$Row;

const dim = (row: Row, i: number) => row.dimensionValues?.[i]?.value ?? "";
const met = (row: Row, i: number) => Number(row.metricValues?.[i]?.value ?? 0);

function parseTotals(res: Report | null): Totals | null {
  const m = res?.rows?.[0]?.metricValues;
  if (!m) return null;
  const n = (i: number) => Number(m[i]?.value ?? 0);
  return {
    sessions: n(0),
    totalUsers: n(1),
    newUsers: n(2),
    conversions: n(3),
    engagedSessions: n(4),
    engagementRate: n(5),
    avgEngagementSeconds: n(6),
  };
}

const TOTAL_METRICS = [
  { name: "sessions" },
  { name: "totalUsers" },
  { name: "newUsers" },
  { name: "keyEvents" },
  { name: "engagedSessions" },
  { name: "engagementRate" },
  { name: "averageSessionDuration" },
];

export async function getGa4Summary(): Promise<Ga4Summary> {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!isGoogleConfigured() || !propertyId) {
    return EMPTY_GA4_SUMMARY;
  }

  const auth = getGoogleAuth([
    "https://www.googleapis.com/auth/analytics.readonly",
  ]);
  const analyticsData = google.analyticsdata({ version: "v1beta", auth });
  const property = `properties/${propertyId}`;
  const dateRanges = [{ startDate: "30daysAgo", endDate: "today" }];
  const previousRange = [{ startDate: "60daysAgo", endDate: "31daysAgo" }];

  const warnings: string[] = [];

  // Optional reports: if one fails we record a warning and carry on, so
  // a single bad dimension can't blank the whole Marketing page.
  async function optional(
    name: string,
    requestBody: analyticsdata_v1beta.Schema$RunReportRequest
  ): Promise<Report | null> {
    try {
      const res = await analyticsData.properties.runReport({
        property,
        requestBody,
      });
      return res.data;
    } catch (err) {
      warnings.push(
        `${name}: ${err instanceof Error ? err.message : "failed"}`
      );
      return null;
    }
  }

  const bySessions = [{ metric: { metricName: "sessions" }, desc: true }];

  // Core reports (these three were already live and working) — failures
  // here do surface as errors.
  const [totalsRes, channelRes, dailyRes] = await Promise.all([
    analyticsData.properties.runReport({
      property,
      requestBody: { dateRanges, metrics: TOTAL_METRICS },
    }),
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges,
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        orderBys: bySessions,
        limit: "10",
      },
    }),
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges,
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "newUsers" },
          { name: "keyEvents" },
        ],
        orderBys: [{ dimension: { dimensionName: "date" } }],
      },
    }),
  ]);

  const [
    previousRes,
    landingRes,
    pagesRes,
    sourceMediumRes,
    campaignRes,
    eventsRes,
    deviceRes,
    countryRes,
    cityRes,
    browserRes,
    newVsReturningRes,
    trackedRes,
    piiRes,
  ] = await Promise.all([
    optional("previous period", {
      dateRanges: previousRange,
      metrics: TOTAL_METRICS,
    }),
    optional("landing pages", {
      dateRanges,
      dimensions: [{ name: "landingPage" }],
      metrics: [
        { name: "sessions" },
        { name: "newUsers" },
        { name: "engagementRate" },
        { name: "keyEvents" },
      ],
      orderBys: bySessions,
      limit: "15",
    }),
    optional("top pages", {
      dateRanges,
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: "15",
    }),
    optional("source / medium", {
      dateRanges,
      dimensions: [{ name: "sessionSourceMedium" }],
      metrics: [
        { name: "sessions" },
        { name: "newUsers" },
        { name: "engagementRate" },
        { name: "keyEvents" },
      ],
      orderBys: bySessions,
      limit: "15",
    }),
    optional("campaigns", {
      dateRanges,
      dimensions: [{ name: "sessionCampaignName" }],
      metrics: [{ name: "sessions" }, { name: "keyEvents" }],
      orderBys: bySessions,
      limit: "10",
    }),
    optional("events", {
      dateRanges,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: "20",
    }),
    optional("device", {
      dateRanges,
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "sessions" }],
      orderBys: bySessions,
    }),
    optional("country", {
      dateRanges,
      dimensions: [{ name: "country" }],
      metrics: [{ name: "sessions" }],
      orderBys: bySessions,
      limit: "10",
    }),
    optional("city", {
      dateRanges,
      dimensions: [{ name: "city" }],
      metrics: [{ name: "sessions" }],
      orderBys: bySessions,
      limit: "10",
    }),
    optional("browser", {
      dateRanges,
      dimensions: [{ name: "browser" }],
      metrics: [{ name: "sessions" }],
      orderBys: bySessions,
      limit: "8",
    }),
    optional("new vs returning", {
      dateRanges,
      dimensions: [{ name: "newVsReturning" }],
      metrics: [{ name: "sessions" }],
    }),
    optional("conversion events", {
      dateRanges,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: TRACKED_EVENTS.map((e) => e.name) } } },
    }),
    // Privacy check: emails in page URLs end up in GA4 and violate its terms.
    optional("email-in-URL check", {
      dateRanges,
      dimensions: [{ name: "pagePathPlusQueryString" }],
      metrics: [{ name: "screenPageViews" }],
      dimensionFilter: {
        orGroup: {
          expressions: [
            { filter: { fieldName: "pagePathPlusQueryString", stringFilter: { matchType: "CONTAINS", value: "@" } } },
            { filter: { fieldName: "pagePathPlusQueryString", stringFilter: { matchType: "CONTAINS", value: "%40" } } },
          ],
        },
      },
      limit: "10",
    }),
  ]);

  const totals = parseTotals(totalsRes.data) ?? {
    sessions: 0,
    totalUsers: 0,
    newUsers: 0,
    conversions: 0,
    engagedSessions: 0,
    engagementRate: 0,
    avgEngagementSeconds: 0,
  };

  const rows = (r: Report | null) => r?.rows ?? [];

  const newVsReturning = { new: 0, returning: 0 };
  for (const row of rows(newVsReturningRes)) {
    if (dim(row, 0) === "new") newVsReturning.new = met(row, 0);
    else if (dim(row, 0) === "returning") newVsReturning.returning = met(row, 0);
  }

  return {
    configured: true,
    sessions: totals.sessions,
    totalUsers: totals.totalUsers,
    newUsers: totals.newUsers,
    conversions: totals.conversions,
    engagementRate: totals.engagementRate,
    avgEngagementSeconds: totals.avgEngagementSeconds,
    engagedSessions: totals.engagedSessions,
    previousPeriod: parseTotals(previousRes),
    byChannel: rows(channelRes.data).map((row) => ({
      channel: dim(row, 0) || "Unknown",
      sessions: met(row, 0),
    })),
    dailySessions: rows(dailyRes.data).map((row) => {
      const raw = dim(row, 0); // YYYYMMDD
      return {
        date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
        sessions: met(row, 0),
        users: met(row, 1),
        newUsers: met(row, 2),
        keyEvents: met(row, 3),
      };
    }),
    topLandingPages: rows(landingRes).map((row) => ({
      page: dim(row, 0) || "(not set)",
      sessions: met(row, 0),
      newUsers: met(row, 1),
      engagementRate: met(row, 2),
      keyEvents: met(row, 3),
    })),
    topPages: rows(pagesRes).map((row) => ({
      page: dim(row, 0) || "(not set)",
      views: met(row, 0),
      users: met(row, 1),
    })),
    bySourceMedium: rows(sourceMediumRes).map((row) => ({
      sourceMedium: dim(row, 0) || "(not set)",
      sessions: met(row, 0),
      newUsers: met(row, 1),
      engagementRate: met(row, 2),
      keyEvents: met(row, 3),
    })),
    byCampaign: rows(campaignRes).map((row) => ({
      campaign: dim(row, 0) || "(not set)",
      sessions: met(row, 0),
      keyEvents: met(row, 1),
    })),
    topEvents: rows(eventsRes).map((row) => ({
      event: dim(row, 0),
      count: met(row, 0),
      users: met(row, 1),
    })),
    trackedEvents: rows(trackedRes).map((row) => ({ event: dim(row, 0), count: met(row, 0), users: met(row, 1) })),
    piiUrlHits: piiRes ? rows(piiRes).reduce((n, row) => n + met(row, 0), 0) : null,
    piiUrlSamples: rows(piiRes).slice(0, 3).map((row) => dim(row, 0).replace(/[^/?&=\s]*(@|%40)[^/?&=\s]*/gi, "[email]").slice(0, 80)),
    byDevice: rows(deviceRes).map((row) => ({
      device: dim(row, 0) || "Unknown",
      sessions: met(row, 0),
    })),
    byCountry: rows(countryRes).map((row) => ({
      country: dim(row, 0) || "Unknown",
      sessions: met(row, 0),
    })),
    byCity: rows(cityRes).map((row) => ({
      city: dim(row, 0) || "(not set)",
      sessions: met(row, 0),
    })),
    byBrowser: rows(browserRes).map((row) => ({
      browser: dim(row, 0) || "Unknown",
      sessions: met(row, 0),
    })),
    newVsReturning,
    warnings,
  };
}
