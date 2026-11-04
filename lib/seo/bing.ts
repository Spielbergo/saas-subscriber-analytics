import { seoSiteUrl } from "./config";
import { readCache, writeCache } from "./store";
import { recordBacklinks } from "./history";
import type { BacklinkData, BacklinkSample, BacklinkTarget } from "./types";

const BASE = "https://ssl.bing.com/webmaster/api.svc/json";

export const EMPTY_BACKLINKS: BacklinkData = {
  configured: false, fetchedAt: null, siteUrl: null, totalLinks: 0,
  targets: [], samples: [], referringDomains: [], error: null,
};

export function bingConfigured(): boolean {
  return Boolean(process.env.BING_WEBMASTER_API_KEY);
}

export function getBacklinkCache(): BacklinkData {
  const cached = readCache<BacklinkData | null>("backlinks.json", null);
  if (cached) return { ...cached, configured: bingConfigured() };
  return { ...EMPTY_BACKLINKS, configured: bingConfigured() };
}

async function bingGet(endpoint: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ ...params, apikey: process.env.BING_WEBMASTER_API_KEY! });
  const res = await fetch(`${BASE}/${endpoint}?${qs}`, { signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bing ${endpoint} returned ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  return json?.d ?? json;
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/**
 * Bing Webmaster Tools inbound-link data (free with an API key). It only
 * knows what Bing has crawled, so counts are lower than Ahrefs/Majestic —
 * treat it as a floor, not a full backlink index.
 */
export async function refreshBacklinks(): Promise<BacklinkData> {
  if (!bingConfigured()) return { ...EMPTY_BACKLINKS };
  const siteUrl = process.env.BING_SITE_URL?.trim() || seoSiteUrl();
  if (!siteUrl) {
    return { ...EMPTY_BACKLINKS, configured: true, error: "Set BING_SITE_URL or SEO_SITE_URL." };
  }

  try {
    const targets: BacklinkTarget[] = [];
    for (let page = 0; page < 3; page++) {
      const d = await bingGet("GetLinkCounts", { siteUrl, page: String(page) });
      for (const l of d?.Links ?? []) {
        targets.push({ url: l.Url ?? l.url ?? "", count: Number(l.Count ?? l.count ?? 0) });
      }
      const totalPages = Number(d?.TotalPages ?? 1);
      if (page + 1 >= totalPages) break;
    }
    targets.sort((a, b) => b.count - a.count);

    const samples: BacklinkSample[] = [];
    for (const t of targets.slice(0, 5)) {
      try {
        const d = await bingGet("GetUrlLinks", { siteUrl, link: t.url, page: "0" });
        for (const l of d?.Details ?? []) {
          samples.push({
            target: t.url,
            source: l.Url ?? l.SourceUrl ?? "",
            anchor: l.AnchorText ?? null,
          });
        }
      } catch {
        /* one target failing shouldn't lose the rest */
      }
    }

    const domains = new Map<string, number>();
    for (const s of samples) {
      if (s.source) domains.set(hostOf(s.source), (domains.get(hostOf(s.source)) ?? 0) + 1);
    }

    const data: BacklinkData = {
      configured: true,
      fetchedAt: new Date().toISOString(),
      siteUrl,
      totalLinks: targets.reduce((n, t) => n + t.count, 0),
      targets: targets.slice(0, 100),
      samples: samples.slice(0, 200),
      referringDomains: Array.from(domains.entries())
        .map(([domain, links]) => ({ domain, links }))
        .sort((a, b) => b.links - a.links),
      error: null,
    };
    writeCache("backlinks.json", data);
    await recordBacklinks(data).catch(() => {});
    return data;
  } catch (err) {
    return {
      ...EMPTY_BACKLINKS,
      configured: true,
      siteUrl,
      error: err instanceof Error ? err.message : "Bing request failed",
    };
  }
}
