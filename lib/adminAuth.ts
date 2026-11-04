import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAllowedAdmin } from "./allowedAdmins";

/**
 * Same Bearer-token check the metrics/marketing routes use. Returns a
 * 401 response if the caller isn't an allow-listed admin, or null if OK.
 */
export async function requireAdmin(request: Request): Promise<NextResponse | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);

  if (error || !user || !isAllowedAdmin(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function errorResponse(label: string, err: unknown) {
  console.error(`[${label}] failed:`, err);
  return NextResponse.json(
    {
      error: `${label} failed`,
      detail: err instanceof Error ? err.message : "Unknown error",
    },
    { status: 500 }
  );
}
