"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardCopy, Check, ChevronDown } from "lucide-react";
import { useDashboard } from "@/lib/DashboardContext";
import { useDateRange } from "@/lib/DateRangeContext";
import { fetchSeoBundle, seoFetch } from "@/lib/seoClient";
import type { Snapshot, Annotation, Post, MentionsResult, CrmData, MonitorStatus } from "@/lib/adminTypes";
import { copyText } from "@/lib/clipboard";
import {
  buildJsonReport,
  buildMarkdownReport,
  estimateTokens,
} from "@/lib/exportReport";

const PII_KEY = "export-include-personal";

export function ExportMenu() {
  const { metrics, marketing, marketingError } = useDashboard();
  const { range } = useDateRange();
  const [open, setOpen] = useState(false);
  const [includePersonal, setIncludePersonal] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setIncludePersonal(localStorage.getItem(PII_KEY) === "1");
    } catch {}
  }, []);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function togglePersonal(v: boolean) {
    setIncludePersonal(v);
    try {
      localStorage.setItem(PII_KEY, v ? "1" : "0");
    } catch {}
  }

  async function run(format: "md" | "json") {
    if (!metrics) return;
    setOpen(false);
    setStatus("Collecting SEO & trend data…");
    // SEO data is fetched on demand so the other tabs stay fast. If it
    // fails (e.g. Search Console not connected) the export still works.
    const seo = await fetchSeoBundle().catch(() => null);
    const trends = await seoFetch<{ snapshots: Snapshot[]; annotations: Annotation[] }>("/api/trends").catch(() => null);
    const ops = await seoFetch<MonitorStatus>("/api/monitor").catch(() => null);
    const [postsRes, mentions] = await Promise.all([
      seoFetch<{ posts: Post[] }>("/api/posts").catch(() => null),
      seoFetch<MentionsResult>("/api/mentions").catch(() => null),
    ]);
    const [crmData, loginDays] = await Promise.all([
      seoFetch<CrmData>("/api/crm").catch(() => null),
      seoFetch<{ available: boolean; days: Record<string, string[]> }>("/api/login-days").then((r) => (r.available ? r.days : null)).catch(() => null),
    ]);
    const crm = { data: crmData, loginDays };
    const growth = postsRes ? { posts: postsRes.posts, mentions } : null;
    const input = {
      metrics,
      trends,
      ops,
      uiRange: { label: range.label, from: range.from, to: range.to },
      growth,
      crm,
      marketing,
      marketingError,
      seo,
      includePersonalData: includePersonal,
    };
    const text =
      format === "md" ? buildMarkdownReport(input) : buildJsonReport(input);
    const ok = await copyText(text);
    setStatus(
      ok
        ? `Copied ${format === "md" ? "Markdown" : "JSON"} (~${estimateTokens(text).toLocaleString()} tokens)`
        : "Copy failed — clipboard blocked by the browser"
    );
    setOpen(false);
    setTimeout(() => setStatus(null), 3500);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={!metrics}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        {status ? (
          <Check size={14} className="text-success" />
        ) : (
          <ClipboardCopy size={14} />
        )}
        {status ?? "Export"}
        {!status && <ChevronDown size={12} className="text-muted" />}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-border bg-surface p-2 shadow-lg">
          <button
            onClick={() => run("md")}
            className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
          >
            Copy as Markdown
            <span className="block text-xs text-muted">
              Best for pasting into an AI chat
            </span>
          </button>
          <button
            onClick={() => run("json")}
            className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
          >
            Copy as JSON
            <span className="block text-xs text-muted">
              Raw structured data
            </span>
          </button>
          <label className="mt-1 flex cursor-pointer items-start gap-2 border-t border-border px-3 pb-1 pt-3 text-xs text-muted">
            <input
              type="checkbox"
              checked={includePersonal}
              onChange={(e) => togglePersonal(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Include names, emails &amp; company names
              <span className="block">
                Off = users appear as masked IDs.
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
