import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/adminAuth";
import { seoSiteUrl } from "@/lib/seo/config";
import { getPageSpeedCache, runPageSpeed } from "@/lib/seo/pagespeed";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const site = seoSiteUrl();
    const strategy = body?.strategy === "desktop" ? "desktop" : "mobile";
    // Only audit pages on your own site — this route shouldn't be usable
    // as a general-purpose "fetch any URL" proxy.
    const host = site ? new URL(site).hostname : null;
    const urls: string[] = (Array.isArray(body?.urls) ? body.urls : [])
      .filter((u: unknown): u is string => typeof u === "string")
      .filter((u: string) => {
        try {
          return host !== null && new URL(u).hostname === host;
        } catch {
          return false;
        }
      });
    if (urls.length === 0) {
      return NextResponse.json({ error: "No valid URLs for this site." }, { status: 400 });
    }
    await runPageSpeed(urls, strategy);
    return NextResponse.json({ pagespeed: getPageSpeedCache() });
  } catch (err) {
    return errorResponse("/api/seo/pagespeed", err);
  }
}
