import { NextResponse } from "next/server";
import { captureSnapshot } from "@/lib/snapshots";

export const dynamic = "force-dynamic";

// Called daily by Vercel Cron (vercel.json) or any external pinger:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron/snapshot
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await captureSnapshot(true));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
