import { NextResponse } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/adminAuth";
import { listSnapshots, listAnnotations } from "@/lib/snapshots";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const [{ snapshots, durable }, annotations] = await Promise.all([listSnapshots(), listAnnotations()]);
    return NextResponse.json({ snapshots, annotations, durable });
  } catch (e) {
    return errorResponse("trends", e);
  }
}
