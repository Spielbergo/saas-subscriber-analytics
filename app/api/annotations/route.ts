import { NextResponse } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/adminAuth";
import { addAnnotation, deleteAnnotation } from "@/lib/snapshots";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const { day, label } = await request.json();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "") || !String(label ?? "").trim()) {
      return NextResponse.json({ error: "day (YYYY-MM-DD) and label required" }, { status: 400 });
    }
    await addAnnotation(day, String(label).trim().slice(0, 120));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse("annotations", e);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const { id } = await request.json();
    await deleteAnnotation(String(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse("annotations", e);
  }
}
