"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import type { Column, SortValue } from "@/components/DataTable";

export function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-sm font-medium">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Mini({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "good" | "warn" | "bad";
}) {
  const color =
    tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : tone === "bad" ? "text-danger" : "";
  return (
    <div className="rounded-xl border border-border bg-bg p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface p-5 text-sm text-muted">
      {children}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  const text = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "";
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      <p className="min-w-0 break-words">{children}</p>
      {text && <CopyButton getText={() => text} label="Copy error" className="shrink-0" />}
    </div>
  );
}

export function RunButton({
  onClick,
  busy,
  children,
  disabled,
}: {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="flex items-center gap-1.5 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
    >
      {busy && <Loader2 size={13} className="animate-spin" />}
      {children}
    </button>
  );
}

const TONES: Record<string, string> = {
  error: "bg-danger/10 text-danger",
  warning: "bg-warning/10 text-warning",
  notice: "bg-accent/10 text-accent",
  good: "bg-success/10 text-success",
  neutral: "bg-surface-2 text-muted",
};
export function Pill({ tone = "neutral", children }: { tone?: keyof typeof TONES | string; children: ReactNode }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone] ?? TONES.neutral}`}>
      {children}
    </span>
  );
}

/** Path-only display of a URL, linking to the full URL. */
export function UrlLink({ url, max = 55 }: { url: string; max?: number }) {
  let label = url;
  try {
    const u = new URL(url);
    label = u.pathname + u.search;
    if (label === "/") label = "/ (home)";
  } catch {
    /* keep raw */
  }
  const short = label.length > max ? `${label.slice(0, max - 1)}…` : label;
  return (
    <a href={url} target="_blank" rel="noreferrer" title={url} className="text-accent hover:underline">
      {short}
    </a>
  );
}

/** Column helper: numbers sort biggest-first on first click, text A→Z. */
export function col<T>(
  key: string,
  header: ReactNode,
  get: (r: T) => SortValue,
  render?: (r: T) => ReactNode,
  opts?: { firstDir?: "asc" | "desc"; className?: string }
): Column<T> {
  return {
    key,
    header,
    sortValue: (r) => {
      const v = get(r);
      return typeof v === "string" ? v.toLowerCase() : v;
    },
    copy: get,
    firstDir: opts?.firstDir,
    className: opts?.className,
    cell: render ?? ((r) => {
      const v = get(r);
      return v === null || v === undefined || v === "" ? <span className="text-muted">—</span> : String(v);
    }),
  };
}
// The first-click direction for numeric columns is "desc"; callers pass
// firstDir explicitly via `num()` below when that's what they want.
export function num<T>(
  key: string,
  header: ReactNode,
  get: (r: T) => number | null | undefined,
  render?: (r: T) => ReactNode,
  opts?: { firstDir?: "asc" | "desc" }
): Column<T> {
  return col<T>(key, header, get, render ?? ((r) => {
    const v = get(r);
    return v === null || v === undefined ? <span className="text-muted">—</span> : <span className="text-muted">{v.toLocaleString()}</span>;
  }), { firstDir: opts?.firstDir ?? "desc" });
}

export const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
export const pos = (v: number) => v.toFixed(1);
export const signed = (v: number, d = 0) => `${v > 0 ? "+" : ""}${v.toFixed(d)}`;

/** Tiny position sparkline: lower position (better) plots higher. */
export function PositionSpark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-xs text-muted">not enough data</span>;
  const w = 90;
  const h = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${((v - min) / range) * (h - 4) + 2}`)
    .join(" ");
  const improving = values[values.length - 1] < values[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="position trend">
      <polyline
        points={pts}
        fill="none"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={improving ? "stroke-success" : "stroke-warning"}
      />
    </svg>
  );
}
