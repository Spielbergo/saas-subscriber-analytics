import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/adminAuth";
import { getSeoBundle } from "@/lib/seo/bundle";
import { getOpportunities } from "@/lib/seo/searchConsoleSeo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    if (new URL(request.url).searchParams.get("refresh") === "1") {
      await getOpportunities(true);
    }
    return NextResponse.json(await getSeoBundle());
  } catch (err) {
    return errorResponse("/api/seo", err);
  }
}
