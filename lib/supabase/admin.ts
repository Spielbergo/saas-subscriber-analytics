import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Secret-key client. Bypasses RLS so this dashboard can read aggregate
 * subscription data even though those tables' RLS policies are written
 * for the main app's own users. This file is marked "server-only" so any
 * accidental client-side import fails the build instead of leaking the key.
 *
 * IMPORTANT: only ever query non-personal columns with this client
 * (see lib/metrics.ts). It has full read access to every table.
 */
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
