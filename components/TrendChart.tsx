"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export function TrendChart({
  signups,
  cancellations,
}: {
  signups: { date: string; count: number }[];
  cancellations: { date: string; count: number }[];
}) {
  const data = signups.map((s, i) => ({
    date: s.date.slice(5), // MM-DD
    signups: s.count,
    cancellations: cancellations[i]?.count ?? 0,
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "rgb(var(--muted))" }}
            interval={4}
            axisLine={{ stroke: "rgb(var(--border))" }}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "rgb(var(--muted))" }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={{
              background: "rgb(var(--surface))",
              border: "1px solid rgb(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="signups"
            stroke="rgb(var(--accent))"
            strokeWidth={2}
            dot={false}
            name="Signups"
          />
          <Line
            type="monotone"
            dataKey="cancellations"
            stroke="rgb(var(--danger))"
            strokeWidth={2}
            dot={false}
            name="Cancellations (approx)"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
