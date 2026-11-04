import "server-only";
import { createSupabaseAdminClient } from "./supabase/admin";
import { readCache, writeCache } from "./seo/store";

/**
 * Persistence for the admin tables (sql/admin_tables.sql). If a table
 * hasn't been created yet, helpers fall back to the local .seo-cache/
 * folder so everything still works in local dev. `available` tells the
 * caller (and the UI) whether the durable Supabase table is in use.
 */

type PgErr = { code?: string; message?: string } | null;

export function isMissingTable(err: PgErr): boolean {
  if (!err) return false;
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    /could not find the table|does not exist|schema cache/i.test(err.message ?? "")
  );
}

const g = globalThis as unknown as { __adminMissing?: Set<string> };
const missing = (g.__adminMissing ??= new Set<string>());

export function sb() {
  return createSupabaseAdminClient();
}

/** Run a Supabase query; on "table missing" remember it and return null. */
export async function tryTable<T>(
  table: string,
  run: () => PromiseLike<{ data: T | null; error: PgErr }>
): Promise<{ ok: true; data: T | null } | { ok: false; missing: boolean; error: string }> {
  if (missing.has(table)) return { ok: false, missing: true, error: `${table} table not created` };
  const { data, error } = await run();
  if (error) {
    if (isMissingTable(error)) {
      missing.add(table);
      return { ok: false, missing: true, error: `${table} table not created` };
    }
    return { ok: false, missing: false, error: error.message ?? "query failed" };
  }
  return { ok: true, data };
}

export const tableMissing = (table: string) => missing.has(table);

// ---------- key/value (with file fallback) ----------

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const r = await tryTable("admin_kv", () =>
    sb().from("admin_kv").select("value").eq("key", key).maybeSingle()
  );
  if (r.ok) return ((r.data as { value: T } | null)?.value ?? fallback) as T;
  return readCache<T>(`kv-${key}.json`, fallback);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const r = await tryTable("admin_kv", () =>
    sb()
      .from("admin_kv")
      .upsert({ key, value, updated_at: new Date().toISOString() })
      .select()
      .then((x) => x as unknown as { data: unknown; error: PgErr })
  );
  if (!r.ok) writeCache(`kv-${key}.json`, value);
}
