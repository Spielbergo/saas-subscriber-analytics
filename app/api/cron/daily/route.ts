import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cronAuth";
import { captureSnapshot } from "@/lib/snapshots";
import { runInfraAlerts, runDailyDigest } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One daily job (Vercel Hobby allows very few cron jobs): snapshot → infra check → digest.
// Each step is isolated so one failure doesn't block the others.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { out[name] = await fn(); } catch (e) { out[name] = { error: e instanceof Error ? e.message : "failed" }; }
  };
  await step("snapshot", () => captureSnapshot(true));
  await step("monitor", () => runInfraAlerts());
  await step("digest", async () => { const d = await runDailyDigest({ send: true }); return { sent: true, attention: d.attention }; });
  return NextResponse.json(out);
}
