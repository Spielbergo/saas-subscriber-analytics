import { NextResponse } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/adminAuth";
import { kvGet, kvSet } from "@/lib/adminStore";
import { cleanViews, type ViewsMap } from "@/lib/savedViews";

export const dynamic = "force-dynamic";
const KEY = "saved_views";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ views: await kvGet<ViewsMap>(KEY, {}) });
  } catch (e) {
    return errorResponse("views", e);
  }
}

// body: { table, views } — replaces that table's saved views.
export async function PUT(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const { table, views } = await request.json();
    if (typeof table !== "string" || !/^[a-z0-9_.-]{1,60}$/i.test(table)) {
      return NextResponse.json({ error: "invalid table key" }, { status: 400 });
    }
    const all = await kvGet<ViewsMap>(KEY, {});
    all[table] = cleanViews(views);
    await kvSet(KEY, all);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse("views", e);
  }
}
