import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/adminAuth";
import { seoSiteUrl } from "@/lib/seo/config";
import { getCrawlResult } from "@/lib/seo/crawlJob";
import { getInspectionCache, inspectUrls } from "@/lib/seo/urlInspection";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const site = seoSiteUrl();
    const host = site ? new URL(site).hostname : null;
    let urls: string[] = (Array.isArray(body?.urls) ? body.urls : []).filter(
      (u: unknown): u is string => typeof u === "string"
    );
    if (urls.length === 0) {
      // Default: indexable pages from the last crawl, sitemap pages first.
      const crawl = getCrawlResult();
      urls = (crawl?.pages ?? [])
        .filter((p) => p.indexable)
        .sort((a, b) => Number(b.inSitemap) - Number(a.inSitemap))
        .map((p) => p.url);
    }
    urls = urls.filter((u) => {
      try {
        return host !== null && new URL(u).hostname === host;
      } catch {
        return false;
      }
    });
    if (urls.length === 0) {
      return NextResponse.json({ error: "No URLs to inspect — run a site audit first." }, { status: 400 });
    }
    await inspectUrls(urls);
    return NextResponse.json({ inspections: getInspectionCache() });
  } catch (err) {
    return errorResponse("/api/seo/inspect", err);
  }
}
