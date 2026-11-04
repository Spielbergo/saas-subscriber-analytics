import { NextResponse } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/adminAuth";
import { getMentions, markMentionsSeen } from "@/lib/mentions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const force = new URL(request.url).searchParams.get("refresh") === "1";
    return NextResponse.json(await getMentions(force));
  } catch (e) { return errorResponse("mentions", e); }
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const { ids } = await request.json();
    await markMentionsSeen(Array.isArray(ids) ? ids.map(String) : []);
    return NextResponse.json({ ok: true });
  } catch (e) { return errorResponse("mentions", e); }
}
