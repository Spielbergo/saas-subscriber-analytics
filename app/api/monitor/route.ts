import { NextResponse } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/adminAuth";
import { getMonitorStatus, refreshExpiry } from "@/lib/monitor";
import { runInfraAlerts, runDailyDigest } from "@/lib/alerts";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await getMonitorStatus());
  } catch (e) {
    return errorResponse("monitor", e);
  }
}

// body.action: "run" (default, throttled to once / 5 min), "refresh" (force cert + domain lookup),
// "test" (send a test notification), "digest-preview", "digest-send"
export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const { action = "run" } = await request.json().catch(() => ({}));
    if (action === "test") {
      const n = await notify({ kind: "test", severity: "info", title: "🧪 Test alert from your dashboard", body: "If you can read this, alerts are wired up correctly." });
      return NextResponse.json({ notification: n });
    }
    if (action === "digest-preview" || action === "digest-send") {
      return NextResponse.json({ digest: await runDailyDigest({ send: action === "digest-send" }) });
    }
    if (action === "refresh") await refreshExpiry(undefined, true);
    const r = action === "refresh" ? null : await runInfraAlerts({ minIntervalSec: 300 });
    return NextResponse.json({ result: r, status: await getMonitorStatus() });
  } catch (e) {
    return errorResponse("monitor", e);
  }
}
