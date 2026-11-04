import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/adminAuth";
import { keywordIdeas } from "@/lib/seo/keywordIdeas";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    if (q.trim().length < 2) return NextResponse.json({ ideas: [] });
    return NextResponse.json({ ideas: await keywordIdeas(q) });
  } catch (err) {
    return errorResponse("/api/seo/keywords", err);
  }
}
