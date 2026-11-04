"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

export function SearchConsoleTrendChart({
  data,
}: {
  data: { date: string; clicks: number; impressions: number }[];
}) {
  const chartData = data.map((d) => ({ ...d, label: d.date.slice(5) }));

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "rgb(var(--muted))" }}
            interval={3}
            axisLine={{ stroke: "rgb(var(--border))" }}
            tickLine={false}
          />
          <YAxis
            yAxisId="clicks"
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "rgb(var(--muted))" }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <YAxis
            yAxisId="impressions"
            orientation="right"
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "rgb(var(--muted))" }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{
              background: "rgb(var(--surface))",
              border: "1px solid rgb(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            yAxisId="clicks"
            type="monotone"
            dataKey="clicks"
            stroke="rgb(var(--accent))"
            strokeWidth={2}
            dot={false}
            name="Clicks"
          />
          <Line
            yAxisId="impressions"
            type="monotone"
            dataKey="impressions"
            stroke="rgb(var(--muted))"
            strokeWidth={2}
            dot={false}
            name="Impressions"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
