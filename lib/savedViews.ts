// Saved table views: pure shapes + helpers (client-safe).
export type SavedView = {
  id: string;
  name: string;
  query: string;
  sort: { key: string; dir: "asc" | "desc" } | null;
  filters: Record<string, string>;
  isDefault?: boolean;
};
export type ViewsMap = Record<string, SavedView[]>;

export const newViewId = () => `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Add or replace by name (case-insensitive); only one default per table. */
export function upsertView(list: SavedView[], v: SavedView): SavedView[] {
  const rest = list.filter((x) => x.name.toLowerCase() !== v.name.toLowerCase() && x.id !== v.id);
  const next = [...rest, v].sort((a, b) => a.name.localeCompare(b.name));
  return v.isDefault ? next.map((x) => (x.id === v.id ? x : { ...x, isDefault: false })) : next;
}

export function setDefault(list: SavedView[], id: string | null): SavedView[] {
  return list.map((x) => ({ ...x, isDefault: x.id === id }));
}

/** Keep only filters/sort that still exist on the table (columns change over time). */
export function sanitizeView(v: SavedView, filterKeys: string[], sortKeys: string[]) {
  return {
    query: v.query ?? "",
    sort: v.sort && sortKeys.includes(v.sort.key) ? v.sort : null,
    filters: Object.fromEntries(Object.entries(v.filters ?? {}).filter(([k, val]) => filterKeys.includes(k) && val)),
  };
}

/** Validate untrusted JSON from the API. */
export function cleanViews(input: unknown): SavedView[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 30).flatMap((x) => {
    const v = x as Partial<SavedView>;
    if (typeof v?.id !== "string" || typeof v.name !== "string" || !v.name.trim()) return [];
    return [{
      id: v.id.slice(0, 40), name: v.name.trim().slice(0, 60), query: String(v.query ?? "").slice(0, 200),
      sort: v.sort && typeof v.sort.key === "string" && (v.sort.dir === "asc" || v.sort.dir === "desc") ? { key: v.sort.key.slice(0, 60), dir: v.sort.dir } : null,
      filters: Object.fromEntries(Object.entries(v.filters ?? {}).slice(0, 20).map(([k, val]) => [k.slice(0, 60), String(val).slice(0, 120)])),
      isDefault: Boolean(v.isDefault),
    }];
  });
}
