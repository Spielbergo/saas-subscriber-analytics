import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/adminAuth";
import { refreshBacklinks } from "@/lib/seo/bing";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ backlinks: await refreshBacklinks() });
  } catch (err) {
    return errorResponse("/api/seo/backlinks", err);
  }
}
