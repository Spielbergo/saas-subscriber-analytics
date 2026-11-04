"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { RefreshCw } from "lucide-react";
import { fetchSeoBundle } from "@/lib/seoClient";
import type { SeoBundle } from "@/lib/seo/types";
import { AuditPanel } from "@/components/seo/AuditPanel";
import { OpportunitiesPanel } from "@/components/seo/OpportunitiesPanel";
import { RankingsPanel } from "@/components/seo/RankingsPanel";
import { IndexingPanel } from "@/components/seo/IndexingPanel";
import { SpeedPanel } from "@/components/seo/SpeedPanel";
import { BacklinksPanel } from "@/components/seo/BacklinksPanel";
import { HistoryPanel } from "@/components/seo/HistoryPanel";
import { InternalLinksPanel } from "@/components/seo/InternalLinksPanel";
import { KeywordIdeasPanel } from "@/components/seo/KeywordIdeasPanel";
import { ErrorNote } from "@/components/seo/common";
import { AiCopyMenu } from "@/components/seo/AiCopyMenu";

const TABS = [
  { id: "audit", label: "Site audit" },
  { id: "opportunities", label: "Opportunities" },
  { id: "links", label: "Internal links" },
  { id: "rankings", label: "Rank tracker" },
  { id: "indexing", label: "Indexing" },
  { id: "speed", label: "Speed" },
  { id: "backlinks", label: "Backlinks" },
  { id: "history", label: "History" },
  { id: "keywords", label: "Keyword ideas" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const TAB_KEY = "seo-tab";

export default function SeoPage() {
  const [bundle, setBundle] = useState<SeoBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("audit");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as TabId | null;
      if (saved && TABS.some((t) => t.id === saved)) setTab(saved);
    } catch {}
  }, []);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setBundle(await fetchSeoBundle(refresh));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load SEO data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const choose = (id: TabId) => {
    setTab(id);
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {}
  };

  const patch = (p: Partial<SeoBundle>) => setBundle((b) => (b ? { ...b, ...p } : b));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => choose(t.id)}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                tab === t.id ? "bg-surface-2 font-medium text-text" : "text-muted hover:text-text"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
        {bundle && <AiCopyMenu bundle={bundle} />}
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 disabled:opacity-50"
          title="Re-pull Search Console data (cached for 10 minutes otherwise)"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Reload SEO data
        </button>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {!bundle && loading && <p className="text-sm text-muted">Loading SEO data…</p>}

      {bundle && (
        <>
          {tab === "audit" && (
            <AuditPanel
              bundle={bundle}
              siteUrl={bundle.siteUrl}
              crawl={bundle.crawl}
              status={bundle.crawlStatus}
              onFinished={() => load()}
            />
          )}
          {tab === "opportunities" && (
            <OpportunitiesPanel data={bundle.opportunities} configured={bundle.config.searchConsole} />
          )}
          {tab === "links" && <InternalLinksPanel bundle={bundle} />}
          {tab === "history" && <HistoryPanel bundle={bundle} />}
          {tab === "rankings" && (
            <RankingsPanel data={bundle.opportunities} configured={bundle.config.searchConsole} />
          )}
          {tab === "indexing" && (
            <IndexingPanel
              inspections={bundle.inspections}
              crawl={bundle.crawl}
              configured={bundle.config.searchConsole}
              onChange={(inspections) => patch({ inspections })}
            />
          )}
          {tab === "speed" && (
            <SpeedPanel
              siteUrl={bundle.siteUrl}
              results={bundle.pagespeed}
              opportunities={bundle.opportunities}
              hasKey={bundle.config.pageSpeedKey}
              onChange={(pagespeed) => patch({ pagespeed })}
            />
          )}
          {tab === "backlinks" && (
            <BacklinksPanel data={bundle.backlinks} onChange={(backlinks) => patch({ backlinks })} />
          )}
          {tab === "keywords" && <KeywordIdeasPanel opportunities={bundle.opportunities} />}
        </>
      )}
    </div>
  );
}
