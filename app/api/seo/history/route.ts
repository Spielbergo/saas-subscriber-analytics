import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/adminAuth";
import { getSeoHistory } from "@/lib/seo/history";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await getSeoHistory());
  } catch (err) {
    return errorResponse("/api/seo/history", err);
  }
}
