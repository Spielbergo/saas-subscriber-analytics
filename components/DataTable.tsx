"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Bookmark, ChevronsUpDown, Download, Search, Star, Trash2, X } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { useSavedViews } from "@/lib/SavedViewsContext";
import { newViewId, sanitizeView, setDefault, upsertView, type SavedView } from "@/lib/savedViews";

export type SortValue = string | number | boolean | null | undefined;

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  // Omit to make the column unsortable.
  sortValue?: (row: T) => SortValue;
  // Plain-text value used by "Copy table". Falls back to sortValue; the
  // column is left out of the copy if neither exists.
  copy?: (row: T) => SortValue;
  // Which direction the first click sorts in. Numbers/dates default to
  // "desc" (biggest/newest first), text to "asc".
  firstDir?: "asc" | "desc";
  className?: string;
};

export type FilterDef<T> = {
  key: string;
  label: string; // e.g. "Plan" -> "All plans" option
  getValue: (row: T) => string | null | undefined;
  // Fixed option order; if omitted, options are the unique values in the data.
  options?: string[];
};

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean")
    return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

const isEmpty = (v: SortValue) => v === null || v === undefined || v === "";

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  title,
  searchText,
  searchPlaceholder = "Search…",
  filters = [],
  initialSort,
  emptyMessage = "Nothing to show.",
  compact = false,
  onRowClick,
  selectedKey,
  maxHeight,
  csvName,
  viewsKey,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T, index: number) => string;
  title?: ReactNode;
  // Provide to show a search box; return the text to match against.
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  filters?: FilterDef<T>[];
  initialSort?: { key: string; dir: "asc" | "desc" };
  emptyMessage?: string;
  compact?: boolean;
  // Optional: make rows clickable (e.g. to show detail below the table).
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  // Cap the table height (px) and scroll inside it — for long lists.
  maxHeight?: number;
  // Filename (without .csv) for the CSV download button. Defaults to the title or "export".
  csvName?: string;
  // Give a table a stable id to enable "Views": save/recall search + filters + sort (stored in your admin database).
  viewsKey?: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    initialSort ?? null
  );
  const [active, setActive] = useState<Record<string, string>>({});

  // ----- saved views -----
  const store = useSavedViews();
  const [viewsOpen, setViewsOpen] = useState(false);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const defaultApplied = useRef(false);
  const myViews: SavedView[] = viewsKey && store ? store.views[viewsKey] ?? [] : [];
  const filterKeys = filters.map((f) => f.key);
  const sortKeys = columns.filter((c) => c.sortValue).map((c) => c.key);

  function applyView(v: SavedView) {
    const clean = sanitizeView(v, filterKeys, sortKeys);
    setQuery(clean.query);
    setSort(clean.sort ?? initialSort ?? null);
    setActive(clean.filters);
    setAppliedId(v.id);
    setViewsOpen(false);
  }
  // Open on the default view (once, after the saved views have loaded).
  useEffect(() => {
    if (!viewsKey || !store?.loaded || defaultApplied.current) return;
    defaultApplied.current = true;
    const d = (store.views[viewsKey] ?? []).find((v) => v.isDefault);
    if (d) applyView(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store?.loaded]);

  function saveCurrent() {
    if (!viewsKey || !store) return;
    const name = window.prompt("Name this view (saving with an existing name replaces it):", "")?.trim();
    if (!name) return;
    const v: SavedView = { id: newViewId(), name, query, sort, filters: Object.fromEntries(Object.entries(active).filter(([, x]) => x)) as Record<string, string> };
    store.saveFor(viewsKey, upsertView(myViews, v));
    setAppliedId(v.id);
  }

  const filterOptions = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of filters) {
      if (f.options) {
        out[f.key] = f.options;
        continue;
      }
      const set = new Set<string>();
      for (const r of rows) {
        const v = f.getValue(r);
        if (v) set.add(v);
      }
      out[f.key] = Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filters.length]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (q && searchText && !searchText(r).toLowerCase().includes(q))
        return false;
      for (const f of filters) {
        const want = active[f.key];
        if (want && (f.getValue(r) ?? "") !== want) return false;
      }
      return true;
    });

    const col = sort && columns.find((c) => c.key === sort.key);
    if (sort && col?.sortValue) {
      const get = col.sortValue;
      const dir = sort.dir === "asc" ? 1 : -1;
      list = list
        .map((r, i) => ({ r, i, v: get(r) }))
        .sort((a, b) => {
          // Empty values always sink to the bottom, whichever direction.
          const ae = isEmpty(a.v);
          const be = isEmpty(b.v);
          if (ae && be) return a.i - b.i;
          if (ae) return 1;
          if (be) return -1;
          return compare(a.v, b.v) * dir || a.i - b.i;
        })
        .map((x) => x.r);
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, sort, active, columns]);

  function toggleSort(col: Column<T>) {
    if (!col.sortValue) return;
    setSort((cur) => {
      if (cur?.key === col.key) {
        return { key: col.key, dir: cur.dir === "asc" ? "desc" : "asc" };
      }
      return { key: col.key, dir: col.firstDir ?? "asc" };
    });
  }

  const activeCount = Object.values(active).filter(Boolean).length;

  // Copies exactly what you see: current filters + sort, as a Markdown
  // table that pastes cleanly into an AI chat or a doc.
  function tableAsMarkdown(): string {
    const cols = columns.filter((c) => c.copy || c.sortValue);
    const esc = (v: SortValue) =>
      v === null || v === undefined ? "" : String(v).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
    const headerText = (c: Column<T>) => (typeof c.header === "string" ? c.header : c.key);
    const lines = [
      `| ${cols.map(headerText).join(" | ")} |`,
      `| ${cols.map(() => "---").join(" | ")} |`,
      ...visible.map(
        (r) => `| ${cols.map((c) => esc((c.copy ?? c.sortValue)!(r))).join(" | ")} |`
      ),
    ];
    return lines.join("\n");
  }
  // Same rows/columns as "Copy table", as a downloadable CSV (UTF-8 with BOM so Excel opens it cleanly).
  function downloadCsv() {
    const cols = columns.filter((c) => c.copy || c.sortValue);
    const q = (v: SortValue) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headerText = (c: Column<T>) => (typeof c.header === "string" ? c.header : c.key);
    const csv = [cols.map((c) => q(headerText(c))).join(","), ...visible.map((r) => cols.map((c) => q((c.copy ?? c.sortValue)!(r))).join(","))].join("\r\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const base = csvName ?? (typeof title === "string" ? title : "export");
    a.href = url;
    a.download = `${base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "export"}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const hasControls = Boolean(searchText) || filters.length > 0;
  const pad = compact ? "py-2" : "py-2.5";

  return (
    <div>
      {(title || hasControls || rows.length > 0) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          {title && (
            <h2 className="text-sm font-medium">
              {title}{" "}
              <span className="text-muted">
                ({visible.length}
                {visible.length !== rows.length ? ` of ${rows.length}` : ""})
              </span>
            </h2>
          )}
          <div className="flex items-center gap-2">
          {viewsKey && store && (
            <div className="relative">
              <button
                onClick={() => setViewsOpen((o) => !o)}
                title="Save and recall search, filters and sort"
                className={`flex items-center gap-1.5 rounded-lg border bg-surface px-2.5 py-1.5 text-xs transition-colors hover:bg-surface-2 ${appliedId ? "border-accent text-text" : "border-border text-muted hover:text-text"}`}
              >
                <Bookmark size={13} /> Views{myViews.length ? ` (${myViews.length})` : ""}
              </button>
              {viewsOpen && (
                <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-border bg-surface p-2 text-xs shadow-lg">
                  {myViews.length === 0 && <p className="px-2 py-1.5 text-muted">No saved views yet. Set up a search, filters and sort, then save it.</p>}
                  {myViews.map((v) => (
                    <div key={v.id} className={`flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-surface-2 ${appliedId === v.id ? "bg-surface-2" : ""}`}>
                      <button onClick={() => applyView(v)} className="min-w-0 flex-1 truncate text-left">{v.name}</button>
                      <button
                        onClick={() => store.saveFor(viewsKey, setDefault(myViews, v.isDefault ? null : v.id))}
                        title={v.isDefault ? "Opens by default (click to unset)" : "Open this view by default"}
                        className={v.isDefault ? "text-warning" : "text-muted hover:text-text"}
                      ><Star size={12} fill={v.isDefault ? "currentColor" : "none"} /></button>
                      <button onClick={() => { if (window.confirm(`Delete view "${v.name}"?`)) store.saveFor(viewsKey, myViews.filter((x) => x.id !== v.id)); }} title="Delete view" className="text-muted hover:text-danger"><Trash2 size={12} /></button>
                    </div>
                  ))}
                  <div className="mt-1 flex gap-1 border-t border-border pt-2">
                    <button onClick={saveCurrent} className="flex-1 rounded-lg bg-surface-2 px-2 py-1.5 hover:text-text">Save current as…</button>
                    <button onClick={() => { setQuery(""); setActive({}); setSort(initialSort ?? null); setAppliedId(null); setViewsOpen(false); }} className="rounded-lg px-2 py-1.5 text-muted hover:text-text">Reset</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {visible.length > 0 && (
            <CopyButton
              getText={tableAsMarkdown}
              label="Copy table"
              title="Copy the rows currently shown (with filters and sort applied) as a Markdown table"
            />
          )}
          {visible.length > 0 && (
            <button
              onClick={downloadCsv}
              title="Download the rows currently shown (filters and sort applied) as a CSV file"
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              <Download size={13} /> CSV
            </button>
          )}
          {searchText && (
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-56 rounded-lg border border-border bg-bg py-1.5 pl-8 pr-3 text-sm outline-none focus:border-accent"
              />
            </div>
          )}
          </div>
        </div>
      )}

      {filters.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {filters.map((f) => (
            <select
              key={f.key}
              value={active[f.key] ?? ""}
              onChange={(e) =>
                setActive((cur) => ({ ...cur, [f.key]: e.target.value }))
              }
              aria-label={`Filter by ${f.label}`}
              className={`rounded-lg border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent ${
                active[f.key] ? "border-accent text-text" : "border-border text-muted"
              }`}
            >
              <option value="">{`All ${f.label.toLowerCase()}`}</option>
              {(filterOptions[f.key] ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ))}
          {activeCount > 0 && (
            <button
              onClick={() => setActive({})}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted hover:text-text"
            >
              <X size={12} /> Clear filters
            </button>
          )}
        </div>
      )}

      <div
        className="overflow-x-auto"
        style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              {columns.map((c) => {
                const isSorted = sort?.key === c.key;
                const sortable = Boolean(c.sortValue);
                return (
                  <th
                    key={c.key}
                    className="pb-2 pr-4 font-medium"
                    aria-sort={
                      isSorted
                        ? sort!.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                  >
                    {sortable ? (
                      <button
                        onClick={() => toggleSort(c)}
                        className={`inline-flex items-center gap-1 whitespace-nowrap font-medium hover:text-text ${
                          isSorted ? "text-text" : ""
                        }`}
                      >
                        {c.header}
                        {isSorted ? (
                          sort!.dir === "asc" ? (
                            <ArrowUp size={11} />
                          ) : (
                            <ArrowDown size={11} />
                          )
                        ) : (
                          <ChevronsUpDown size={11} className="opacity-40" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((r, i) => (
              <tr
                key={rowKey(r, i)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={
                  onRowClick
                    ? `cursor-pointer hover:bg-surface-2 ${
                        selectedKey && selectedKey === rowKey(r, i) ? "bg-surface-2" : ""
                      }`
                    : undefined
                }
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`${pad} pr-4 ${c.className ?? "whitespace-nowrap"}`}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="py-6 text-center text-sm text-muted"
                >
                  {rows.length === 0 ? emptyMessage : "No rows match the current filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
