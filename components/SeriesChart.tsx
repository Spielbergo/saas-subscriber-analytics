"use client";

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import type { Annotation } from "@/lib/adminTypes";

export type SeriesDef = { key: string; label: string; color: "accent" | "success" | "warning" | "danger" | "muted" };

/** Line chart over a daily series, with optional annotation markers. */
export function SeriesChart({
  data,
  series,
  annotations = [],
  height = 240,
  money,
}: {
  data: Record<string, number | string | null>[]; // each row needs `day`
  series: SeriesDef[];
  annotations?: Annotation[];
  height?: number;
  money?: boolean;
}) {
  const days = new Set(data.map((d) => String(d.day)));
  const marks = annotations.filter((a) => days.has(a.day));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
          <XAxis
            dataKey="day"
            tickFormatter={(d: string) => d.slice(5)}
            tick={{ fontSize: 11, fill: "rgb(var(--muted))" }}
            axisLine={{ stroke: "rgb(var(--border))" }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "rgb(var(--muted))" }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={(v: number) => (money ? `$${v}` : String(v))}
            allowDecimals={!!money}
          />
          <Tooltip
            contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--border))", borderRadius: 8, fontSize: 12 }}
            formatter={(v: number) => (money ? `$${Number(v).toLocaleString()}` : v)}
            labelFormatter={(d: string) => {
              const notes = annotations.filter((a) => a.day === d).map((a) => a.label);
              return notes.length ? `${d} — ${notes.join("; ")}` : d;
            }}
          />
          {marks.map((a) => (
            <ReferenceLine
              key={a.id}
              x={a.day}
              stroke="rgb(var(--muted))"
              strokeDasharray="4 3"
              label={{ value: a.label.length > 18 ? `${a.label.slice(0, 17)}…` : a.label, position: "top", fontSize: 10, fill: "rgb(var(--muted))" }}
            />
          ))}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={`rgb(var(--${s.color}))`}
              strokeWidth={2}
              dot={data.length < 20}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
