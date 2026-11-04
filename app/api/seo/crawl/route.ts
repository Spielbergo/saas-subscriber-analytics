import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/adminAuth";
import { loadLatestCrawl, getCrawlStatus, startCrawl, stopCrawl } from "@/lib/seo/crawlJob";

export const dynamic = "force-dynamic";

// GET: live status (cheap, polled while a crawl runs).
export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const status = getCrawlStatus();
  // Return the finished result only once, when asked, to keep polls small.
  const wantResult = new URL(request.url).searchParams.get("result") === "1";
  return NextResponse.json({ status, crawl: wantResult ? await loadLatestCrawl() : undefined });
}

// POST { action: "start" | "stop" }
export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.action === "stop") {
      stopCrawl();
      return NextResponse.json({ status: getCrawlStatus() });
    }
    const r = startCrawl();
    if (!r.started) return NextResponse.json({ error: r.reason, status: getCrawlStatus() }, { status: 409 });
    return NextResponse.json({ status: getCrawlStatus() });
  } catch (err) {
    return errorResponse("/api/seo/crawl", err);
  }
}
