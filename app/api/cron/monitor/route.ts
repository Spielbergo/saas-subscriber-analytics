import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cronAuth";
import { runInfraAlerts } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Uptime / SSL / domain checks + alerts. Vercel Hobby only runs this daily;
// for 5-minute checks point cron-job.org or UptimeRobot at:
//   https://your-app/api/cron/monitor?secret=$CRON_SECRET
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runInfraAlerts({ minIntervalSec: 60 }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
