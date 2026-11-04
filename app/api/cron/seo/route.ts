import { NextResponse } from "next/server";
import { crawlNow } from "@/lib/seo/crawlJob";
import { getSeoHistory } from "@/lib/seo/history";
import { diffAudits } from "@/lib/seo/diff";
import { runPageSpeed } from "@/lib/seo/pagespeed";
import { bingConfigured, refreshBacklinks } from "@/lib/seo/bing";
import { seoSiteUrl } from "@/lib/seo/config";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Weekly SEO job (vercel.json) — or call it yourself:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron/seo
// Crawls the site, records the audit, snapshots speed + backlinks, and
// returns what changed since the previous audit.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const out: Record<string, unknown> = {};
  try {
    const before = (await getSeoHistory()).audits;
    const crawl = await crawlNow();
    const after = (await getSeoHistory()).audits;
    const cur = after[after.length - 1];
    const prev = before[before.length - 1];
    out.audit = { score: crawl.score, pages: crawl.pagesCrawled, diff: prev && cur && prev.at !== cur.at ? diffAudits(prev, cur) : null };
  } catch (e) {
    out.audit = { error: e instanceof Error ? e.message : "crawl failed" };
  }
  const site = seoSiteUrl();
  if (site) {
    try {
      const r = [...(await runPageSpeed([site], "mobile")), ...(await runPageSpeed([site], "desktop"))];
      out.speed = r.map((x) => ({ strategy: x.strategy, performance: x.performance, error: x.error }));
    } catch (e) { out.speed = { error: e instanceof Error ? e.message : "failed" }; }
  }
  if (bingConfigured()) {
    try { const b = await refreshBacklinks(); out.backlinks = { total: b.totalLinks, error: b.error }; }
    catch (e) { out.backlinks = { error: e instanceof Error ? e.message : "failed" }; }
  }
  return NextResponse.json(out);
}
