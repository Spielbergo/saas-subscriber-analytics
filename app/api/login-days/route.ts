import { NextResponse } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/adminAuth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// { available: false } until sql/crm_data.sql has been run.
export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const { data, error } = await createSupabaseAdminClient().rpc("admin_get_login_days");
    if (error) return NextResponse.json({ available: false, days: {} });
    const days: Record<string, string[]> = {};
    for (const r of (data as { user_id: string; day: string }[]) ?? []) (days[r.user_id] ??= []).push(String(r.day).slice(0, 10));
    return NextResponse.json({ available: true, days });
  } catch (e) { return errorResponse("login-days", e); }
}
