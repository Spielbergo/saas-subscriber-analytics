import { NextResponse } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/adminAuth";
import { listPosts, addPost, deletePost } from "@/lib/postsStore";
import { addAnnotation } from "@/lib/snapshots";
import { seoSiteUrl } from "@/lib/seo/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ ...(await listPosts()), siteUrl: seoSiteUrl() });
  } catch (e) { return errorResponse("posts", e); }
}

const s = (v: unknown, n = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const b = await request.json();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.postedOn ?? "")) return NextResponse.json({ error: "postedOn (YYYY-MM-DD) required" }, { status: 400 });
    await addPost({ postedOn: b.postedOn, platform: s(b.platform, 60), title: s(b.title, 200), url: s(b.url, 1000), utmSource: s(b.utmSource, 80), utmMedium: s(b.utmMedium, 80), utmCampaign: s(b.utmCampaign, 120), utmContent: s(b.utmContent, 120), notes: s(b.notes, 1000) });
    if (b.annotate) await addAnnotation(b.postedOn, `Posted: ${s(b.title, 80) ?? s(b.platform, 60) ?? "post"}`);
    return NextResponse.json({ ok: true });
  } catch (e) { return errorResponse("posts", e); }
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const { id } = await request.json();
    await deletePost(String(id));
    return NextResponse.json({ ok: true });
  } catch (e) { return errorResponse("posts", e); }
}
