import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cronAuth";
import { runDailyDigest } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const d = await runDailyDigest({ send: true });
    return NextResponse.json({ sent: true, attention: d.attention });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
