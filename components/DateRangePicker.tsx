"use client";

import { CalendarRange } from "lucide-react";
import { PRESETS } from "@/lib/dateRange";
import { useDateRange } from "@/lib/DateRangeContext";

/** Global range: applies to Trends, Subscribers, Growth, Revenue and the Overview chart. */
export function DateRangePicker() {
  const { state, setState, range } = useDateRange();
  const inputCls = "rounded-md border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="flex items-center gap-1 text-muted" title="Applies to Trends, Subscribers, Growth, Revenue and the Overview chart. GA4 and Search Console panels keep their fixed 30 / 28-day windows.">
        <CalendarRange size={13} /> Date range
      </span>
      <div className="flex gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setState({ preset: p.id, from: p.id === "custom" ? state.from : null, to: p.id === "custom" ? state.to : null })}
            className={`rounded-md border px-2 py-1 ${state.preset === p.id ? "border-accent text-text" : "border-border text-muted hover:text-text"}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {state.preset === "custom" && (
        <>
          <input type="date" aria-label="From" value={state.from ?? ""} onChange={(e) => setState({ ...state, from: e.target.value || null })} className={inputCls} />
          <span className="text-muted">→</span>
          <input type="date" aria-label="To" value={state.to ?? ""} onChange={(e) => setState({ ...state, to: e.target.value || null })} className={inputCls} />
        </>
      )}
      {!range.isAll && <span className="text-muted">{range.from} → {range.to ?? "today"}</span>}
    </div>
  );
}
