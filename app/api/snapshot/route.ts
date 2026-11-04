import { NextResponse } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/adminAuth";
import { captureSnapshot } from "@/lib/snapshots";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await captureSnapshot(Boolean(body?.force)));
  } catch (e) {
    return errorResponse("snapshot", e);
  }
}
