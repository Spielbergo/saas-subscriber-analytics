import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Auth + publishable-key client. Used in the browser to sign in, and
 * also imported server-side (API route) to validate a user's access
 * token. This never touches subscriber data directly — see
 * lib/supabase/admin.ts for that.
 *
 * Session is stored in localStorage by default (no cookies at all),
 * which sidesteps the cookie-chunking/431 issues that come with
 * SSR-cookie-based auth for a locally-run internal tool like this.
 *
 * Kept as a module-level singleton so the browser doesn't spin up a new
 * GoTrueClient (and its own localStorage listener) on every call —
 * that's what the "Multiple GoTrueClient instances" console warning
 * was about. Harmless, but this avoids it.
 */
let browserClient: SupabaseClient | undefined;

export function createSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    );
  }
  return browserClient;
}
